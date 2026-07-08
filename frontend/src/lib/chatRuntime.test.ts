// ==========================================
// chatRuntime Tests (Extended)
// ==========================================

import { describe, expect, it } from 'vitest';
import {
  normalizeAssistantText,
  isToolCallLikeText,
  chooseAssistantContent,
  normalizeUiErrorMessage,
  extractRepoProfileFromToolResult,
  mergeRepoProfileIntoMemory,
  mergePlannerArtifactIntoMemory,
  mergeExecutionArtifactsIntoMemory,
  extractRuntimeArtifact,
  mergeRuntimeArtifactIntoMemory,
  buildValidationSnapshot,
  mergeValidationIntoMemory,
  mergeApprovalDecisionIntoMemory,
  buildEvidenceSummary,
  mergeEvidenceSummaryIntoMemory,
  mergeGuiCapabilitiesIntoMemory,
  mergeGovernanceIntoMemory,
  mergeHumanCheckpointIntoMemory,
  mergeGuiObservationIntoMemory,
  resolveActiveGuiSessionInMemory,
} from './chatRuntime';
import type { PlannerArtifact, ExecutionArtifact, ApprovalRequest, RuntimeArtifact, GuiCapabilityStatus } from './types';

// ==========================================
// normalizeAssistantText
// ==========================================
describe('normalizeAssistantText', () => {
  it('extracts response field from JSON wrapper', () => {
    expect(normalizeAssistantText('{"response": "Hello world"}')).toBe('Hello world');
  });

  it('handles escaped quotes', () => {
    expect(normalizeAssistantText('{"response": "She said \\"hi\\""}')).toBe('She said "hi"');
  });

  it('returns plain text unchanged', () => {
    expect(normalizeAssistantText('Hello world')).toBe('Hello world');
  });

  it('returns empty string for non-string input', () => {
    expect(normalizeAssistantText(null as any)).toBe('');
    expect(normalizeAssistantText(undefined as any)).toBe('');
  });

  it('strips raw tool call json blocks', () => {
    expect(normalizeAssistantText('{"name":"web_search","arguments":{"query":"Baku weather today"}}')).toBe('');
  });

  it('strips raw tool call json blocks prefixed with json', () => {
    expect(normalizeAssistantText('json { "name": "web_fetch", "arguments": {"url":"https://wttr.in/Baku?format=3"} }')).toBe('');
  });

  it('strips leaked tool argument fragments', () => {
    expect(normalizeAssistantText('"arguments": { "url": "https://wttr.in/Baku?format=3" }')).toBe('');
  });

  it('strips leaked query fragments', () => {
    expect(normalizeAssistantText('"query": "today\'s FIFA World Cup qualification matches"')).toBe('');
  });

  it('strips leaked command fragments', () => {
    expect(normalizeAssistantText('"command": "date"')).toBe('');
  });
});

describe('isToolCallLikeText', () => {
  it('detects raw tool call json', () => {
    expect(isToolCallLikeText('{"name":"web_search","arguments":{"query":"Baku weather today"}}')).toBe(true);
  });

  it('detects raw tool call json prefixed with json', () => {
    expect(isToolCallLikeText('json { "name": "web_fetch", "arguments": {"url":"https://wttr.in/Baku?format=3"} }')).toBe(true);
  });

  it('detects leaked arguments fragment', () => {
    expect(isToolCallLikeText('"arguments": { "url": "https://wttr.in/Baku?format=3" }')).toBe(true);
  });

  it('detects leaked query fragment', () => {
    expect(isToolCallLikeText('"query": "today\'s FIFA World Cup qualification matches"')).toBe(true);
  });

  it('detects leaked command fragment', () => {
    expect(isToolCallLikeText('"command": "date"')).toBe(true);
  });

  it('does not flag normal prose', () => {
    expect(isToolCallLikeText('Bakida hava bu gun serindir.')).toBe(false);
  });
});

// ==========================================
// chooseAssistantContent
// ==========================================
describe('chooseAssistantContent', () => {
  it('prefers final when it is longer', () => {
    const streamed = 'short';
    const final = 'this is a longer and more complete response';
    expect(chooseAssistantContent(streamed, final)).toBe(final);
  });

  it('keeps streamed when final looks truncated', () => {
    const streamed = 'A long and detailed response that was streamed properly and has all the content we need. This is the full response.';
    const final = 'A long and detailed response that was streamed:';
    expect(chooseAssistantContent(streamed, final)).toBe(streamed);
  });

  it('keeps streamed when streamed is much longer and final is short', () => {
    expect(chooseAssistantContent('This is a much longer streamed response that goes on and on with details', 'Short final')).toBe('This is a much longer streamed response that goes on and on with details');
  });

  it('prefers final when it is complete and reasonable length', () => {
    expect(chooseAssistantContent('start of response', 'Complete final response with all details')).toBe('Complete final response with all details');
  });
});

// ==========================================
// normalizeUiErrorMessage
// ==========================================
describe('normalizeUiErrorMessage', () => {
  it('returns default for empty content', () => {
    expect(normalizeUiErrorMessage('')).toBe('Naməlum xəta baş verdi.');
  });

  it('strips known prefixes', () => {
    expect(normalizeUiErrorMessage('API xətası: X')).toBe('X');
    expect(normalizeUiErrorMessage('Tool xətası: Y')).toBe('Y');
    expect(normalizeUiErrorMessage('Error executing tool: Z')).toBe('Z');
  });

  it('keeps regular text', () => {
    expect(normalizeUiErrorMessage('just an error')).toBe('just an error');
  });
});

// ==========================================
// extractRepoProfileFromToolResult
// ==========================================
describe('extractRepoProfileFromToolResult', () => {
  it('extracts JSON from REPO_PROFILE_JSON marker', () => {
    const result = extractRepoProfileFromToolResult(
      'Some text\n[REPO_PROFILE_JSON]\n{"ecosystem": "Node.js", "packageManager": "npm"}\n\nMore text'
    );
    expect(result).toBeTruthy();
    expect((result as any)?.ecosystem).toBe('Node.js');
  });

  it('returns null when no marker present', () => {
    expect(extractRepoProfileFromToolResult('just text')).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(extractRepoProfileFromToolResult('[REPO_PROFILE_JSON]\n{invalid}')).toBeNull();
  });
});

// ==========================================
// mergeRepoProfileIntoMemory
// ==========================================
describe('mergeRepoProfileIntoMemory', () => {
  it('merges repo profile fields into memory', () => {
    const result = mergeRepoProfileIntoMemory({}, { ecosystem: 'Node.js', packageManager: 'npm', frameworks: ['React'] } as any);
    expect(result.ecosystem).toBe('Node.js');
    expect(result.packageManager).toBe('npm');
    expect(result.frameworks).toEqual(['React']);
  });

  it('preserves existing fields', () => {
    const result = mergeRepoProfileIntoMemory({ existing: 'keep' }, { ecosystem: 'Node.js' } as any);
    expect(result.existing).toBe('keep');
  });
});

// ==========================================
// mergePlannerArtifactIntoMemory
// ==========================================
describe('mergePlannerArtifactIntoMemory', () => {
  it('stores artifact and metadata into memory', () => {
    const artifact: PlannerArtifact = {
      goal: 'Refactor code',
      filesToInspect: ['src/index.ts'],
      suspectedRisks: ['Breaking change'],
      implementationSteps: ['Step 1'],
      verificationSteps: ['Test'],
      workUnits: [],
      summary: 'Full refactor plan',
    };
    const result = mergePlannerArtifactIntoMemory({}, artifact, 'refactor this');
    expect(result.latestPrompt).toBe('refactor this');
    expect(result.plannerArtifact).toBe(artifact);
    expect(result.plannerSummary).toBe('Full refactor plan');
    expect(result.plannedFiles).toEqual(['src/index.ts']);
  });
});

// ==========================================
// mergeExecutionArtifactsIntoMemory
// ==========================================
describe('mergeExecutionArtifactsIntoMemory', () => {
  it('stores artifacts and sets lastExecutionArtifact', () => {
    const artifacts: ExecutionArtifact[] = [
      { role: 'coder', summary: 'Wrote code', toolNames: ['write_file'], timestamp: 1000 },
    ];
    const result = mergeExecutionArtifactsIntoMemory({}, artifacts);
    expect(result.executionArtifacts).toHaveLength(1);
    expect(result.lastExecutionArtifact).toBe(artifacts[0]);
  });
});

// ==========================================
// extractRuntimeArtifact
// ==========================================
describe('extractRuntimeArtifact', () => {
  it('extracts browser artifact from browser_ tool', () => {
    const result = extractRuntimeArtifact('browser_open', '{"url":"https://example.com"}', 'Session: abc-123\nBrowser opened');
    expect(result?.kind).toBe('browser');
    expect(result?.sessionId).toBe('abc-123');
    expect(result?.url).toBe('https://example.com');
  });

  it('extracts browser artifact with screenshot path', () => {
    const result = extractRuntimeArtifact('browser_screenshot', '{}', 'Screenshot saved: /tmp/shot.png');
    expect(result?.kind).toBe('browser');
    expect(result?.screenshotPath).toBe('/tmp/shot.png');
  });

  it('extracts gui artifact', () => {
    const result = extractRuntimeArtifact('gui_observe', '{}', JSON.stringify({
      observation: { url: 'https://example.com', screenshotPath: '/tmp/gui.png' },
      action: { type: 'click', selector: '#btn' },
      assessment: { executable: true, reason: 'Button visible' },
      reflection: { success: true },
    }));
    expect(result?.kind).toBe('gui');
    expect(result?.url).toBe('https://example.com');
    expect((result as any)?.assessment?.executable).toBe(true);
  });

  it('marks failed gui artifact', () => {
    const result = extractRuntimeArtifact('gui_step', '{}', JSON.stringify({
      observation: {},
      assessment: { executable: false, reason: 'Element not found' },
    }));
    expect(result?.status).toBe('failed');
  });

  it('extracts terminal artifact', () => {
    const result = extractRuntimeArtifact('run_terminal_command', '{"command":"ls -la"}', 'total 5\n-rw-r--r--  1 user  staff  100 file.txt');
    expect(result?.kind).toBe('terminal');
    expect(result?.command).toBe('ls -la');
    expect(result?.status).toBe('info');
  });

  it('marks failed terminal artifact', () => {
    const result = extractRuntimeArtifact('run_terminal_command', '{"command":"invalid"}', 'exit code 1\nError: not found');
    expect(result?.status).toBe('failed');
  });

  it('returns null for unknown tool', () => {
    expect(extractRuntimeArtifact('unknown_tool', '{}', 'output')).toBeNull();
  });
});

// ==========================================
// mergeRuntimeArtifactIntoMemory
// ==========================================
describe('mergeRuntimeArtifactIntoMemory', () => {
  it('stores artifact and updates history', () => {
    const artifact: RuntimeArtifact = {
      kind: 'terminal', toolName: 'run_terminal_command', command: 'ls', summary: 'listed files',
      output: 'file.txt', status: 'info', timestamp: 1000,
    };
    const result = mergeRuntimeArtifactIntoMemory({}, artifact);
    expect(result.lastRuntimeArtifact).toBe(artifact);
    expect(result.runtimeArtifacts).toHaveLength(1);
  });

  it('caps runtimeArtifacts at 12', () => {
    const oldArtifacts = Array.from({ length: 12 }, (_, i) => ({
      kind: 'terminal' as const, toolName: 'term', command: `cmd${i}`, summary: `s${i}`,
      output: `o${i}`, status: 'info' as const, timestamp: i,
    }));
    const state = { runtimeArtifacts: oldArtifacts };
    const newArtifact: RuntimeArtifact = {
      kind: 'terminal', toolName: 'run_terminal_command', command: 'new', summary: 'new',
      output: 'new', status: 'info', timestamp: 9999,
    };
    const result = mergeRuntimeArtifactIntoMemory(state, newArtifact);
    expect(result.runtimeArtifacts).toHaveLength(12);
    expect(result.runtimeArtifacts[11].timestamp).toBe(9999);
  });

  it('creates activeGuiSession for browser artifact with sessionId', () => {
    const artifact: RuntimeArtifact = {
      kind: 'browser', toolName: 'browser_open', summary: 'opened', sessionId: 'sess-1',
      url: 'https://example.com', status: 'info', timestamp: 1000,
    };
    const result = mergeRuntimeArtifactIntoMemory({}, artifact);
    expect(result.activeGuiSession?.sessionId).toBe('sess-1');
    expect(result.activeGuiSession?.status).toBe('ready');
  });
});

// ==========================================
// buildValidationSnapshot
// ==========================================
describe('buildValidationSnapshot', () => {
  it('detects passed validation', () => {
    const result = buildValidationSnapshot('Test results: [passed] all good');
    expect(result?.status).toBe('passed');
  });

  it('detects failed validation', () => {
    const result = buildValidationSnapshot('Test results: [failed] something broke');
    expect(result?.status).toBe('failed');
  });

  it('returns null for neutral output', () => {
    expect(buildValidationSnapshot('just some output')).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(buildValidationSnapshot('')).toBeNull();
  });
});

// ==========================================
// mergeValidationIntoMemory
// ==========================================
describe('mergeValidationIntoMemory', () => {
  it('stores validation and adds to history', () => {
    const v = { summary: 'Tests passed', status: 'passed', updatedAt: 1000 };
    const result = mergeValidationIntoMemory({}, v);
    expect(result.lastValidation).toBe(v);
    expect(result.validationHistory).toHaveLength(1);
  });

  it('caps validationHistory at 8', () => {
    const old = Array.from({ length: 8 }, (_, i) => ({ summary: `s${i}`, status: 'passed', updatedAt: i }));
    const v = { summary: 'new', status: 'failed', updatedAt: 9999 };
    const result = mergeValidationIntoMemory({ validationHistory: old }, v);
    expect(result.validationHistory).toHaveLength(8);
  });
});

// ==========================================
// mergeApprovalDecisionIntoMemory
// ==========================================
describe('mergeApprovalDecisionIntoMemory', () => {
  it('stores approval decision and adds to history', () => {
    const approval: ApprovalRequest = { approvalId: 'a1', tool: 'write_file', args: '{}', meta: { title: 'Write file', riskLevel: 'high' } };
    const result = mergeApprovalDecisionIntoMemory({}, approval, 'approve');
    expect(result.lastApprovalDecision?.tool).toBe('write_file');
    expect(result.lastApprovalDecision?.decision).toBe('approve');
    expect(result.approvalHistory).toHaveLength(1);
  });
});

// ==========================================
// buildEvidenceSummary
// ==========================================
describe('buildEvidenceSummary', () => {
  it('shows missing for empty memory', () => {
    const result = buildEvidenceSummary({});
    expect(result.headline).toContain('0 ok');
    expect(result.headline).toContain('0 failed');
    expect(result.headline).toContain('4 missing');
  });

  it('counts passed and failed evidence', () => {
    const result = buildEvidenceSummary({
      lastValidation: { status: 'passed', summary: 'ok' },
      lastBrowserArtifact: { kind: 'browser', summary: 'loaded', status: 'info', timestamp: 1 },
      lastTerminalArtifact: { kind: 'terminal', summary: 'error', status: 'failed', timestamp: 2 },
    });
    expect(result.headline).toContain('2 ok');
    expect(result.headline).toContain('1 failed');
    expect(result.headline).toContain('1 missing');
  });
});

// ==========================================
// mergeEvidenceSummaryIntoMemory
// ==========================================
describe('mergeEvidenceSummaryIntoMemory', () => {
  it('adds evidence summary to memory', () => {
    const result = mergeEvidenceSummaryIntoMemory({});
    expect(result.evidenceSummary).toBeDefined();
    expect(result.evidenceSummary?.headline).toContain('missing');
  });
});

// ==========================================
// mergeGuiCapabilitiesIntoMemory
// ==========================================
describe('mergeGuiCapabilitiesIntoMemory', () => {
  it('stores GUI capability status', () => {
    const caps = {
      summary: { status: 'ok', recommendedWorkflow: 'gui', recommendedBrowserMode: 'persistent' },
      runtime: { platform: 'darwin', nodeEnv: 'development', isRemoteLinux: false },
      browser: {
        automationAvailable: true, playwrightInstalled: true, installedBrowsers: [],
        chromeInstalled: true, fallbackChromePath: '/usr/bin/google-chrome',
        requestedMode: 'persistent', resolvedMode: 'persistent', modeStatus: 'ok',
        cdpUrl: '', supportsPersistent: true, supportsCdp: true,
      },
      screenAgent: { available: true, supportedPlatform: true, pythonPath: '/usr/bin/python3', pythonExists: true, openCommandAvailable: true, reasons: [] },
      computerUse: { available: false, supportedPlatform: false, appPath: '', binaryPath: '', infoPlistPath: '', configPath: '', appExists: false, binaryExists: false, infoPlistExists: false, configExists: false, bundleDetected: false, bundleId: '', config: null, reasons: [] },
      warnings: [],
    } as GuiCapabilityStatus;
    const result = mergeGuiCapabilitiesIntoMemory({}, caps);
    expect(result.guiCapabilities).toBe(caps);
  });
});

// ==========================================
// mergeGovernanceIntoMemory
// ==========================================
describe('mergeGovernanceIntoMemory', () => {
  it('stores governance state', () => {
    const result = mergeGovernanceIntoMemory({}, { mode: 'audit', reason: 'test' }, { runId: 'r1', workflow: 'solo', entryPath: { mode: 'audit', reason: 'test' }, overall: 'ready', evidence: [], handoff: { plannerGoal: '', nextFocus: [], unresolvedRisk: '' } });
    expect(result.governance).toBeDefined();
    expect(result.governance?.entryPath.mode).toBe('audit');
  });
});

// ==========================================
// mergeHumanCheckpointIntoMemory
// ==========================================
describe('mergeHumanCheckpointIntoMemory', () => {
  it('creates activeGuiSession from login checkpoint', () => {
    const result = mergeHumanCheckpointIntoMemory({}, {
      id: 'cp1', kind: 'login', workflow: 'gui', sessionId: 'sess-1',
      conversationId: 'conv1', runId: 'run1', phaseRole: 'Planner',
      title: 'Login', message: 'Please login', resumePrompt: 'done',
    });
    expect((result as any).activeGuiSession.sessionId).toBe('sess-1');
    expect((result as any).activeGuiSession.status).toBe('pending_login');
  });

  it('returns memory unchanged when no sessionId', () => {
    const result = mergeHumanCheckpointIntoMemory({ key: 'val' }, { id: 'cp1', kind: 'login', title: 'Login', message: 'msg', resumePrompt: 'done' });
    expect(result).toEqual({ key: 'val' });
  });
});

// ==========================================
// mergeGuiObservationIntoMemory
// ==========================================
describe('mergeGuiObservationIntoMemory', () => {
  it('updates activeGuiSession status to ready', () => {
    const result = mergeGuiObservationIntoMemory({
      activeGuiSession: { sessionId: 'sess-1', status: 'pending_login', updatedAt: 1000 },
    }, { kind: 'gui', summary: 'observed', url: 'https://example.com', status: 'info', timestamp: 2000 } as RuntimeArtifact);
    expect((result as any).activeGuiSession.status).toBe('ready');
  });

  it('marks session as failed when artifact failed', () => {
    const result = mergeGuiObservationIntoMemory({
      activeGuiSession: { sessionId: 'sess-1', status: 'observing', updatedAt: 1000 },
    }, { kind: 'gui', summary: 'error', status: 'failed', timestamp: 2000 } as RuntimeArtifact);
    expect((result as any).activeGuiSession.status).toBe('failed');
  });
});

// ==========================================
// resolveActiveGuiSessionInMemory
// ==========================================
describe('resolveActiveGuiSessionInMemory', () => {
  it('sets status to observing on resume', () => {
    const result = resolveActiveGuiSessionInMemory({
      activeGuiSession: { sessionId: 'sess-1', status: 'pending_login', updatedAt: 1000 },
    }, 'resume');
    expect((result as any).activeGuiSession.status).toBe('observing');
  });

  it('sets status to closed on cancel', () => {
    const result = resolveActiveGuiSessionInMemory({
      activeGuiSession: { sessionId: 'sess-1', status: 'pending_login', updatedAt: 1000 },
    }, 'cancel');
    expect((result as any).activeGuiSession.status).toBe('closed');
  });

  it('returns memory unchanged when no activeGuiSession', () => {
    const result = resolveActiveGuiSessionInMemory({}, 'cancel');
    expect(result).toEqual({});
  });
});

// ==========================================
// Active GUI session memory (existing tests preserved)
// ==========================================
describe('active GUI session memory (legacy)', () => {
  it('stores checkpoint session as pending login', () => {
    const memory = mergeHumanCheckpointIntoMemory({}, {
      id: 'cp1', kind: 'login', workflow: 'gui', sessionId: 'gui-wix-live',
      conversationId: 'conv1', runId: 'run1', phaseRole: 'Planner',
      title: 'Wix login checkpoint', message: 'login et', resumePrompt: 'login oldum',
    });
    expect((memory as any).activeGuiSession.sessionId).toBe('gui-wix-live');
    expect((memory as any).activeGuiSession.status).toBe('pending_login');
  });

  it('marks gui session ready after gui observation artifact', () => {
    const memory = mergeGuiObservationIntoMemory({
      activeGuiSession: { sessionId: 'gui-wix-live', status: 'pending_login', updatedAt: Date.now() },
    }, {
      kind: 'gui', summary: 'Action: observe', url: 'https://manage.wix.com/dashboard',
      status: 'info', timestamp: Date.now(),
    });
    expect((memory as any).activeGuiSession.status).toBe('ready');
    expect((memory as any).activeGuiSession.url).toContain('wix.com');
  });

  it('closes active gui session on cancel', () => {
    const memory = resolveActiveGuiSessionInMemory({
      activeGuiSession: { sessionId: 'gui-wix-live', status: 'pending_login', updatedAt: Date.now() },
    }, 'cancel');
    expect((memory as any).activeGuiSession.status).toBe('closed');
  });

  it('keeps the longer streamed answer when final content looks truncated', () => {
    const streamed = 'Bəli, Azərbaycan Respublikasının Vergi Məcəlləsi haqqında ümumi məlumata sahibəm. Vergi Məcəlləsi 2000-ci ildə qəbul edilib və iki əsas hissədən ibarətdir: Ümumi hissə və Xüsusi hissə. Əsas vergi növləri bunlardır.';
    const final = 'Bəli, Azərbaycan Respublikasının Vergi Məcəlləsi haqqında ümumi məlumata sahibəm. Əsas vergi növləri:';
    expect(chooseAssistantContent(streamed, final)).toBe(streamed);
  });

  it('prefers the final answer when it is complete and longer', () => {
    const streamed = 'Bakıda hava';
    const final = 'Bu gün Bakı üçün ən dəqiq nəticəni web axtarışdan yoxlayıb sizə temperatur intervalını deyə bilərəm.';
    expect(chooseAssistantContent(streamed, final)).toBe(final);
  });
});
