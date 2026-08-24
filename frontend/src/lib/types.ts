export interface Project {
  id: string;
  name: string;
  path: string;
  createdAt: number;
  repoUrl?: string;
  archived?: boolean;
  lastPort?: number;
}

export interface Attachment {
  id: string; // SEC-Audit: id is now mandatory
  name: string;
  type: string;
  mimeType?: string;
  url: string;
  extractedText?: string;
  extractionError?: string;
  imageUrl?: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  attachments?: Attachment[];
  timestamp: number;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  providerInfo?: {
    providerId?: string;
    model?: string;
    status?: string;
    wireApi?: string;
  };
}

export interface ToolCall {
  id?: string;
  type?: string;
  status?: 'running' | 'done' | 'error';
  duration?: number;
  result?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
  name?: string;
  args?: string;
}

export interface ApprovalRequest {
  approvalId: string;
  tool: string;
  args: string;
  conversationId?: string;
  runId?: string;
  phaseRole?: string;
  expiresAt?: number;
  meta?: {
    riskLevel?: 'low' | 'medium' | 'high';
    reason?: string;
    title?: string;
    summary?: string;
    preview?: string;
    path?: string;
    command?: string;
    diffPreview?: string;
    diffStats?: {
      added: number;
      removed: number;
    } | null;
  };
}

export interface HumanCheckpoint {
  id: string;
  kind: 'login' | 'confirmation' | 'manual_step';
  workflow?: string;
  sessionId?: string;
  conversationId?: string;
  runId?: string;
  phaseRole?: string;
  expiresAt?: number;
  title: string;
  message: string;
  resumePrompt: string;
  cancelPrompt?: string;
  resumeLabel?: string;
  cancelLabel?: string;
}

export interface ActionCenterInteraction {
  id: string;
  kind: 'approval' | 'checkpoint';
  createdAt?: number;
  approval?: ApprovalRequest;
  checkpoint?: HumanCheckpoint;
}

export interface Conversation {
  id: string;
  projectId: string;
  title: string;
  messages: Message[];
  archived?: boolean;
  pinned?: boolean;
  pinnedAt?: number;
  lastMessageAt?: number;
  preview?: string;
  summaryText?: string;
  messageCount?: number;
  messagesLoaded?: boolean;
  messagesHasMore?: boolean;
  oldestMessageCursor?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Settings {
  // AI Provider & Modes
  productMode: 'web_chat' | 'desktop_code';
  executionMode: 'cloud' | 'local';
  apiKey: string;
  baseUrl: string;
  model: string;
  projectDir: string;
  performanceMode: boolean;
  orchestrationMode: boolean;
  workflow: string;
  customInstructions: string;

  // Browser Automation
  guiBrowserMode: string;
  guiBrowserPath: string;
  guiBrowserCdpUrl: string;
  guiAutoStartBrowser: boolean;
  aiMode: 'smart' | 'manual';

  // Appearance & Layout (LibreChat style)
  language: string;
  messageFontSize: string;
  chatDirection: 'ltr' | 'rtl';
  maximizeChatSpace: boolean;
  centerChatInput: boolean;
  scrollToEndButton: boolean;

  // Accessibility
  keepScreenAwake: boolean;

  // Chat preferences
  enterToSend: boolean;
  enableMarkdown: boolean;
  showThinking: boolean;
  autoScroll: boolean;
}

export interface ModelOption {
  id: string;
  name: string;
  provider: string;
}

export interface PlannerArtifact {
  goal: string;
  filesToInspect: string[];
  suspectedRisks: string[];
  implementationSteps: string[];
  verificationSteps: string[];
  workUnits: Array<{
    label: string;
    parallel: boolean;
    blockedBy?: string;
    role?: string;
  }>;
  summary: string;
}

export interface ExecutionArtifact {
  role: string;
  summary: string;
  toolNames: string[];
  timestamp: number;
}

export interface RuntimeArtifact {
  kind: 'browser' | 'terminal' | 'gui';
  toolName?: string;
  sessionId?: string;
  command?: string;
  summary: string;
  screenshotPath?: string;
  selector?: string;
  url?: string;
  action?: Record<string, unknown> | null;
  assessment?: {
    executable?: boolean;
    reason?: string;
    source?: string;
  } | null;
  output?: string;
  status?: 'passed' | 'failed' | 'info';
  timestamp: number;
}

export interface ProviderTelemetryEvent {
  event: 'provider_skip_cooldown' | 'provider_stream_start' | 'provider_failure' | 'provider_failover' | 'provider_wireapi_downgrade';
  providerId?: string;
  previousProviderId?: string;
  fromProviderId?: string;
  toProviderId?: string;
  model?: string;
  toModel?: string;
  wireApi?: string;
  status?: number | string | null;
  message?: string;
  timestamp?: number;
}

export interface GuiCapabilityStatus {
  summary: {
    status: 'ok' | 'degraded' | 'missing';
    recommendedWorkflow: string;
    recommendedBrowserMode: string;
  };
  runtime: {
    platform: string;
    nodeEnv: string;
    isRemoteLinux: boolean;
  };
  browser: {
    automationAvailable: boolean;
    playwrightInstalled: boolean;
    installedBrowsers: Array<{ id: string; name: string; path: string; installed: boolean; supportsCdp: boolean; recommended?: boolean }>;
    chromeInstalled: boolean;
    fallbackChromePath: string;
    requestedMode: string;
    resolvedMode: string;
    modeStatus: 'ok' | 'degraded' | 'missing';
    cdpUrl: string;
    supportsPersistent: boolean;
    supportsCdp: boolean;
  };
  screenAgent: {
    available: boolean;
    supportedPlatform: boolean;
    pythonPath: string;
    pythonExists: boolean;
    openCommandAvailable: boolean;
    reasons: string[];
  };
  computerUse: {
    available: boolean;
    supportedPlatform: boolean;
    appPath: string;
    binaryPath: string;
    infoPlistPath: string;
    configPath: string;
    appExists: boolean;
    binaryExists: boolean;
    infoPlistExists: boolean;
    configExists: boolean;
    bundleDetected: boolean;
    bundleId: string;
    config: {
      locale: string;
      direction: string;
      accentColor: string;
    } | null;
    reasons: string[];
  };
  warnings: string[];
}

export interface ActiveGuiSession {
  sessionId: string;
  workflow?: string;
  status: 'pending_login' | 'ready' | 'observing' | 'failed' | 'closed';
  title?: string;
  url?: string;
  checkpointId?: string;
  conversationId?: string;
  runId?: string;
  phaseRole?: string;
  updatedAt: number;
}

export interface GovernanceEntryPath {
  mode: 'audit' | 'bootstrap' | 'spec-intake';
  reason: string;
}

export interface GateReceipt {
  runId: string;
  workflow: string;
  entryPath: GovernanceEntryPath;
  overall: 'ready' | 'partial' | 'blocked';
  evidence: Array<{
    label: string;
    status: string;
    summary: string;
  }>;
  handoff: {
    plannerGoal: string;
    nextFocus: string[];
    unresolvedRisk: string;
  };
}

export type ThemeMode = 'light' | 'dark' | 'system';

export type SSEEvent =
  | { type: 'assistant_message'; message: any }
  | { type: 'assistant_delta'; content: string }
  | ({ type: 'provider_telemetry' } & ProviderTelemetryEvent)
  | { type: 'tool_execution'; tool: string; args: string; tool_call_id?: string }
  | { type: 'tool_result'; result: any }
  | { type: 'task_plan'; items: string[] }
  | { type: 'orchestration_state'; runId: string; workflow: string; mode: 'solo' | 'orchestrated' | 'manager_direct'; agents: string[]; routing?: { mode: 'direct' | 'delegated'; primaryAgent: string; secondaryAgents: string[]; reason: string } }
  | { type: 'orchestration_phase'; runId: string; currentRole: string; phases: Array<{ role: string; status: 'pending' | 'active' | 'completed' }>; workUnits?: PlannerArtifact['workUnits'] }
  | { type: 'auto_route'; intent: 'fast' | 'smart'; chosenModel: string; providerId: string }
  | { type: 'approval_request'; approvalId: string; tool: string; args: string; meta?: ApprovalRequest['meta'] }
  | { type: 'approval_resolved'; approvalId: string; decision: 'approved' | 'rejected' }
  | { type: 'human_checkpoint'; checkpoint: HumanCheckpoint }
  | { type: 'governance_state'; entryPath: GovernanceEntryPath; gateReceipt: GateReceipt }
  | { type: 'workspace_updated'; path: string }
  | { type: 'error'; message: string }
  | { type: 'debug'; info: any };
