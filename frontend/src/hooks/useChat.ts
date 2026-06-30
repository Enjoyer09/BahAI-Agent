// ==========================================
// useChat Hook — Fully Immutable & Audit-Safe
// ==========================================

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { Message, Conversation, Project, Settings, PlannerArtifact, ExecutionArtifact, ApprovalRequest, HumanCheckpoint, ActionCenterInteraction } from '../lib/types';
import { trackChatMessage, trackChatError, trackToolUse } from '../lib/telemetry';
import {
  applyDiff,
  createConversationOnServer,
  createProjectOnServer,
  deleteConversationOnServer,
  deleteProjectOnServer,
  extractAttachments,
  getProjectMemory,
  getInteractions,
  getTaskPlan,
  loadWorkspaceState,
  previewDiff,
  resolveCheckpoint as resolveCheckpointRequest,
  runProjectHealthCheck,
  runTerminalStream,
  saveProjectMemory,
  sendChatMessage,
  submitApproval,
  updateConversationOnServer,
  updateProjectOnServer
} from '../lib/api';
import {
  normalizeAssistantText,
  normalizeUiErrorMessage,
  extractRepoProfileFromToolResult,
  mergeRepoProfileIntoMemory,
  mergePlannerArtifactIntoMemory,
  mergeExecutionArtifactsIntoMemory,
  extractRuntimeArtifact,
  mergeRuntimeArtifactIntoMemory,
  buildValidationSnapshot,
  mergeValidationIntoMemory,
  mergeApprovalDecisionIntoMemory
} from '../lib/chatRuntime';

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const saved = localStorage.getItem(key);
    if (!saved) return fallback;
    return JSON.parse(saved);
  } catch {
    return fallback;
  }
}

function buildConversationTitleFromInput(input: string): string {
  const text = String(input || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return 'Yeni söhbət';

  const cleaned = text
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/^(zəhmət olmasa|zehmet olmasa|please)\s+/i, '')
    .trim();

  if (!cleaned) return 'Yeni söhbət';
  if (cleaned.length <= 48) return cleaned;

  const sliced = cleaned.slice(0, 48);
  const lastSpace = sliced.lastIndexOf(' ');
  return `${(lastSpace > 20 ? sliced.slice(0, lastSpace) : sliced).trim()}...`;
}

export function useChat(settings: Settings, userKey?: string | number | null) {
  const [projects, setProjects] = useState<Project[]>(() => loadFromStorage('projects', []));
  const [conversations, setConversations] = useState<Conversation[]>(() => loadFromStorage('conversations', []));
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [serverBacked, setServerBacked] = useState(false);
  const [abortController, setAbortController] = useState<AbortController | null>(null);
  const [previewKey, setPreviewKey] = useState(0);
  // FUNC-FIX: Safe Mode default off — for a personal coding agent the constant
  // approval prompts were the #1 friction point. Power users can still flip
  // it on from ChatInput (now exposed) or OpsPanel.
  const [safeMode, setSafeMode] = useState(() => localStorage.getItem('safeMode') === '1');
  useEffect(() => { localStorage.setItem('safeMode', safeMode ? '1' : '0'); }, [safeMode]);
  const [taskPlan, setTaskPlan] = useState<string[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<ApprovalRequest[]>([]);
  const [humanCheckpoint, setHumanCheckpoint] = useState<HumanCheckpoint | null>(null);
  const [actionCenterInteractions, setActionCenterInteractions] = useState<ActionCenterInteraction[]>([]);
  const [actionCenterHistory, setActionCenterHistory] = useState<ActionCenterInteraction[]>([]);
  const [projectMemory, setProjectMemory] = useState<Record<string, unknown>>({});
  const [plannerArtifact, setPlannerArtifact] = useState<PlannerArtifact | null>(null);
  const [executionArtifacts, setExecutionArtifacts] = useState<ExecutionArtifact[]>([]);

  // Ref to track current active conversation (avoids stale closure in sendMessage)
  const activeConvIdRef = useRef<string | null>(null);
  // FUNC-FIX: throttle ref for streaming delta updates (see below).
  const streamThrottleRef = useRef<number>(0);
  const streamBufferRef = useRef<string>('');
  useEffect(() => {
    activeConvIdRef.current = activeConvId;
  }, [activeConvId]);

  useEffect(() => {
    // Prevent cross-account bleed in the same browser session.
    setProjects([]);
    setConversations([]);
    setActiveConvId(null);
    setHydrated(false);
    setServerBacked(false);
  }, [userKey]);

  // PERF-1: Debounced Persistence
  const storageTimeout = useRef<any>(null);
  useEffect(() => {
    if (serverBacked) return;
    if (storageTimeout.current) clearTimeout(storageTimeout.current);
    storageTimeout.current = setTimeout(() => {
      localStorage.setItem('projects', JSON.stringify(projects));
      localStorage.setItem('conversations', JSON.stringify(conversations));
    }, 500);
    return () => { if (storageTimeout.current) clearTimeout(storageTimeout.current); };
  }, [projects, conversations, serverBacked]);

  useEffect(() => {
    if (!userKey) {
      setHydrated(true);
      return;
    }
    let cancelled = false;

    const loadServerState = async () => {
      try {
        const state = await loadWorkspaceState();
        if (cancelled) return;

        if (state.projects.length === 0) {
          const created = await createProjectOnServer({
            name: 'bahAI Sandbox',
            path: 'workspace://default'
          });
          if (cancelled) return;
          const welcomeMessage: Message = {
            id: generateId(),
            role: 'assistant',
            content: 'Salam! Mən bahAI agentiyəm. Sizin üçün ayrıca şəxsi workspace yaratdım. Buradakı fayllar yalnız sizin hesabınıza bağlıdır.',
            timestamp: Date.now()
          };
          setProjects([created.project]);
          setConversations([{
            ...created.conversation,
            messages: [welcomeMessage]
          }]);
          setActiveConvId(created.conversation.id);
          await updateConversationOnServer(created.conversation.id, {
            messages: [welcomeMessage]
          });
        } else {
          setProjects(state.projects);
          setConversations(state.conversations);
          setActiveConvId(state.conversations[0]?.id || null);
        }
        setServerBacked(true);
      } catch {
        setServerBacked(false);
        const localProjects = loadFromStorage<Project[]>('projects', []);
        const localConvs = loadFromStorage<Conversation[]>('conversations', []);
        setProjects(localProjects);
        setConversations(localConvs);
        if (localConvs.length > 0) {
          setActiveConvId(localConvs[0].id);
        }
      } finally {
        if (!cancelled) setHydrated(true);
      }
    };

    loadServerState();

    return () => {
      cancelled = true;
    };
  }, [userKey]);

  // Auto-initialize default project & conversation if empty, or select active one
  useEffect(() => {
    if (!hydrated || serverBacked) return;
    if (projects.length === 0) {
      const defaultProjId = generateId();
      const defaultProj: Project = {
        id: defaultProjId,
        name: 'bahAI Sandbox',
        path: 'workspace://default',
        createdAt: Date.now()
      };
      
      const defaultConvId = generateId();
      const defaultConv: Conversation = {
        id: defaultConvId,
        projectId: defaultProjId,
        title: 'Xoş Gəlmisiniz!',
        messages: [
          {
            id: generateId(),
            role: 'assistant',
            content: 'Salam! Mən bahAI agentiyəm. Layihə seçilmədiyi üçün sizin üçün avtomatik olaraq bir "bahAI Sandbox" (Qaralama) iş sahəsi yaratdım. İndi bura nəsə yaza bilərsiniz, sizə kömək etməyə hazıram! 🚀',
            timestamp: Date.now()
          }
        ],
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      
      setProjects([defaultProj]);
      setConversations([defaultConv]);
      setActiveConvId(defaultConvId);
    } else if (!activeConvId && conversations.length > 0) {
      setActiveConvId(conversations[0].id);
    }
  }, [projects, conversations, activeConvId, hydrated, serverBacked]);

  const activeConversation = useMemo(() => 
    conversations.find(c => c.id === activeConvId) || null
  , [conversations, activeConvId]);

  const messages = useMemo(() => activeConversation?.messages || [], [activeConversation]);

  const activeProject = useMemo(() => 
    projects.find(p => p.id === activeConversation?.projectId) || null
  , [projects, activeConversation]);

  useEffect(() => {
    const loadMemory = async () => {
      if (!activeProject?.id || !serverBacked) {
        setProjectMemory({});
        setPlannerArtifact(null);
        setExecutionArtifacts([]);
        return;
      }
      try {
        const memory = await getProjectMemory(activeProject.id);
        setProjectMemory(memory);
        const savedArtifact = memory?.plannerArtifact;
        if (savedArtifact && typeof savedArtifact === 'object') {
          setPlannerArtifact(savedArtifact as PlannerArtifact);
        } else {
          setPlannerArtifact(null);
        }
        const savedExecutionArtifacts = Array.isArray(memory?.executionArtifacts) ? memory.executionArtifacts : [];
        setExecutionArtifacts(savedExecutionArtifacts as ExecutionArtifact[]);
      } catch {
        setProjectMemory({});
        setPlannerArtifact(null);
        setExecutionArtifacts([]);
      }
    };
    loadMemory();
  }, [activeProject?.id, serverBacked]);

  useEffect(() => {
    if (!serverBacked) {
      setActionCenterInteractions([]);
      return;
    }
    getInteractions()
      .then((items) => {
        setActionCenterInteractions(items);
        const approvals = items
          .filter((item) => item.kind === 'approval' && item.approval)
          .map((item) => item.approval!) as ApprovalRequest[];
        const checkpoint = items.find((item) => item.kind === 'checkpoint')?.checkpoint || null;
        setPendingApprovals(approvals);
        setHumanCheckpoint(checkpoint);
      })
      .catch(() => {
        setActionCenterInteractions([]);
      });
  }, [serverBacked, activeConvId]);

  const createConversation = useCallback((projectId: string, title: string = 'Yeni söhbət') => {
    // Abort any running request when creating a new conversation
    if (abortController) {
      abortController.abort();
      setAbortController(null);
    }
    setLoading(false);

    const newConv: Conversation = {
      id: generateId(),
      projectId,
      title,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setConversations(prev => [newConv, ...prev]);
    setActiveConvId(newConv.id);
    if (serverBacked) {
      createConversationOnServer(projectId, title)
        .then(serverConv => {
          setConversations(prev => prev.map(c => c.id === newConv.id ? serverConv : c));
          setActiveConvId(serverConv.id);
        })
        .catch(console.error);
    }
    return newConv.id;
  }, [serverBacked, abortController]);

  const createProject = useCallback((name: string, path: string, repoUrl?: string) => {
    const newProj: Project = { id: generateId(), name, path, createdAt: Date.now(), repoUrl };
    const localConv: Conversation = {
      id: generateId(),
      projectId: newProj.id,
      title: name,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setProjects(prev => [...prev, newProj]);
    setConversations(prev => [localConv, ...prev]);
    setActiveConvId(localConv.id);

    if (serverBacked) {
      createProjectOnServer({ name, path, repoUrl })
        .then(({ project, conversation }) => {
          setProjects(prev => prev.map(p => p.id === newProj.id ? project : p));
          setConversations(prev => prev.map(c => c.id === localConv.id ? conversation : c));
          setActiveConvId(conversation.id);
        })
        .catch(console.error);
    }

    return localConv.id;
  }, [serverBacked]);

  const updateProject = useCallback((id: string, updates: Partial<Project>) => {
    setProjects(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
    if (serverBacked) updateProjectOnServer(id, updates).catch(console.error);
  }, [serverBacked]);

  const sendMessage = useCallback(async (input: string, attachments: any[] = []) => {
    if (!input.trim() && attachments.length === 0) return;
    if (!activeConvId) return;

    if (abortController) {
      abortController.abort();
      setAbortController(null);
    }

    // Capture the conversation ID at the time of sending
    const convId = activeConvId;
    const activeConv = conversations.find(c => c.id === convId) || null;

    const enrichedAttachments = await extractAttachments(attachments);
    const userMsg: Message = { id: generateId(), role: 'user', content: input, attachments: enrichedAttachments, timestamp: Date.now() };
    const shouldAutoRenameConversation = activeConv && (!activeConv.title || activeConv.title === 'Yeni söhbət');
    const nextTitle = shouldAutoRenameConversation ? buildConversationTitleFromInput(input) : activeConv?.title;
    
    // Add user message to state
    let currentMsgs = [...messages, userMsg];
    setConversations(prev => prev.map(c => c.id === convId ? {
      ...c,
      title: c.id === convId && shouldAutoRenameConversation ? (nextTitle || c.title) : c.title,
      messages: currentMsgs,
      updatedAt: Date.now()
    } : c));
    if (serverBacked && shouldAutoRenameConversation && nextTitle) {
      updateConversationOnServer(convId, { title: nextTitle, messages: currentMsgs }).catch(console.error);
    }
    
    setLoading(true);
    setTaskPlan([]);
    setPlannerArtifact(null);
    setExecutionArtifacts([]);
    streamBufferRef.current = '';
    const controller = new AbortController();
    setAbortController(controller);

    try {
      // Task plan arxa planda — chat-i bloklamır
      getTaskPlan(input, activeProject?.path || settings.projectDir)
        .then(plan => setTaskPlan(plan.items))
        .catch(() => setTaskPlan([]));

      const MAX_HISTORY_MESSAGES = 16;
      const historySlice = currentMsgs.slice(-MAX_HISTORY_MESSAGES);
      const preparedMessages = historySlice.map((m, idx) => {
        const isRecent = idx >= historySlice.length - 6;
        const trimmedToolCalls = isRecent
          ? m.tool_calls?.map((tc: any) => ({
              id: tc.id,
              type: tc.type || 'function',
              function: {
                name: tc.function?.name || tc.name || '',
                arguments: String(tc.function?.arguments || tc.args || '').slice(0, 2000)
              }
            }))
          : undefined;

        return ({
        role: m.role,
        content: String(m.content || '').slice(0, 8000),
        // Keep extracted text. If extraction failed on last user message, send URL for backend retry.
        attachments: m.attachments?.map((at: any) => {
          const hasText = at.extractedText && at.extractedText.trim();
          return {
            id: at.id,
            name: at.name,
            type: at.type,
            mimeType: at.mimeType,
            extractedText: at.extractedText || '',
            extractionError: at.extractionError,
            url: (!hasText && idx === historySlice.length - 1 && m.role === 'user')
              ? (at.url || '')
              : ''
          };
        }),
        tool_calls: trimmedToolCalls,
        tool_call_id: m.tool_call_id
      })});

      await sendChatMessage(
        preparedMessages,
        settings.apiKey, settings.baseUrl, settings.model, activeProject?.path || settings.projectDir,
        {
          safeMode,
          projectId: activeProject?.id,
          conversationId: convId,
          orchestrationMode: settings.orchestrationMode,
          workflow: settings.workflow,
          guiBrowserMode: settings.guiBrowserMode,
          guiBrowserPath: settings.guiBrowserPath,
          guiBrowserCdpUrl: settings.guiBrowserCdpUrl
        },
        (event: any) => {
          if (event.type === 'task_plan') {
            const items = Array.isArray(event.items) ? event.items : [];
            setTaskPlan(items);
            return;
          }
          if (event.type === 'orchestration_state') {
            const routingLine = event.routing?.reason ? `\nMarşrut: ${event.routing.primaryAgent}${event.routing.secondaryAgents?.length ? ` -> ${event.routing.secondaryAgents.join(' -> ')}` : ''}\nSəbəb: ${event.routing.reason}` : '';
            const note: Message = {
              id: generateId(),
              role: 'system',
              content: `Workflow: **${event.workflow}** | Rejim: **${event.mode}** | Agentlər: ${Array.isArray(event.agents) ? event.agents.join(', ') : ''}${routingLine}`,
              timestamp: Date.now()
            };
            currentMsgs = [...currentMsgs, note];
            setConversations(prev => prev.map(c => c.id === convId ? { ...c, messages: currentMsgs, updatedAt: Date.now() } : c));
            return;
          }
          if (event.type === 'orchestration_phase') {
            if ((event as any).currentRole === 'Manager') {
              return;
            }
            const phaseSummary = Array.isArray(event.phases)
              ? event.phases.map((phase) => `${phase.role}: ${phase.status}`).join(' | ')
              : '';
            const note: Message = {
              id: generateId(),
              role: 'system',
              content: `Faza: **${event.currentRole}**${phaseSummary ? ` | ${phaseSummary}` : ''}`,
              timestamp: Date.now()
            };
            currentMsgs = [...currentMsgs, note];
            setConversations(prev => prev.map(c => c.id === convId ? { ...c, messages: currentMsgs, updatedAt: Date.now() } : c));
            return;
          }
          // FUNC-FIX: surface the Auto router's decision as a small system
          // message at the top of the assistant turn ("Auto → ...").
          if (event.type === 'auto_route') {
            const isCloud = event.providerId?.includes('cloud') || /\//.test(event.chosenModel || '');
            const icon = isCloud ? '☁️' : '🦙';
            const tier = event.intent === 'smart' ? 'Mürəkkəb iş' : 'Sürətli sual';
            const note: Message = {
              id: generateId(),
              role: 'system',
              content: `${icon} Auto → **${event.chosenModel}** (${tier})`,
              timestamp: Date.now()
            } as Message;
            currentMsgs = [...currentMsgs, note];
            setConversations(prev => prev.map(c => c.id === convId ? { ...c, messages: currentMsgs, updatedAt: Date.now() } : c));
            return;
          }
          if (event.type === 'error') {
            const errMsg: Message = { id: generateId(), role: 'assistant', content: `❌ Xəta: ${normalizeUiErrorMessage(event.message)}`, timestamp: Date.now() };
            currentMsgs = [...currentMsgs, errMsg];
            trackChatError(settings.model, event.message);
            setConversations(prev => prev.map(c => c.id === convId ? { ...c, messages: currentMsgs, updatedAt: Date.now() } : c));
            return;
          }
          if (event.type === 'debug') {
            if (event.info?.plannerArtifact) {
              const artifact = event.info.plannerArtifact as PlannerArtifact;
              setPlannerArtifact(artifact);
              if (activeProject?.id) {
                const mergedMemory = mergePlannerArtifactIntoMemory(projectMemory, artifact, input);
                setProjectMemory(mergedMemory);
                if (serverBacked) {
                  saveProjectMemory(activeProject.id, mergedMemory).catch(console.error);
                }
              }
            }
            if (Array.isArray(event.info?.executionArtifacts)) {
              const artifacts = event.info.executionArtifacts as ExecutionArtifact[];
              setExecutionArtifacts(artifacts);
              if (activeProject?.id) {
                const mergedMemory = mergeExecutionArtifactsIntoMemory(projectMemory, artifacts);
                setProjectMemory(mergedMemory);
                if (serverBacked) {
                  saveProjectMemory(activeProject.id, mergedMemory).catch(console.error);
                }
              }
            }
            return;
          }
          if (event.type === 'approval_request') {
            const approval = {
              approvalId: event.approvalId,
              tool: event.tool,
              args: event.args,
              conversationId: event.conversationId,
              runId: event.runId,
              phaseRole: event.phaseRole,
              expiresAt: event.expiresAt,
              meta: event.meta
            };
            setPendingApprovals(prev => [...prev, approval]);
            setActionCenterInteractions(prev => [
              ...prev.filter(item => item.id !== event.approvalId),
              { id: event.approvalId, kind: 'approval', approval }
            ]);
            return;
          }
          if (event.type === 'approval_resolved') {
            setPendingApprovals(prev => prev.filter(item => item.approvalId !== event.approvalId));
            setActionCenterInteractions(prev => {
              const resolved = prev.find(item => item.id === event.approvalId);
              if (resolved) {
                setActionCenterHistory(history => [resolved, ...history].slice(0, 12));
              }
              return prev.filter(item => item.id !== event.approvalId);
            });
            return;
          }
          if (event.type === 'human_checkpoint') {
            setHumanCheckpoint(event.checkpoint);
            setActionCenterInteractions(prev => [
              ...prev.filter(item => item.kind !== 'checkpoint'),
              { id: event.checkpoint.id, kind: 'checkpoint', checkpoint: event.checkpoint }
            ]);
            return;
          }
          if (event.type === 'assistant_delta') {
            const deltaText = normalizeAssistantText(String(event.content || ''));
            streamBufferRef.current = normalizeAssistantText((streamBufferRef.current || '') + deltaText);
            // Streaming — real-time mətn yeniləməsi
            const lastMsg = currentMsgs[currentMsgs.length - 1];
            if (lastMsg && lastMsg.role === 'assistant' && !lastMsg.tool_calls) {
              // Mövcud streaming mesajını yenilə
              const updatedMsg = { ...lastMsg, content: streamBufferRef.current };
              currentMsgs = [...currentMsgs.slice(0, -1), updatedMsg];
            } else {
              // Yeni streaming mesajı yarat
              const streamMsg: Message = {
                id: 'streaming_' + Date.now(),
                role: 'assistant',
                content: streamBufferRef.current,
                timestamp: Date.now()
              };
              currentMsgs = [...currentMsgs, streamMsg];
            }
            // FUNC-FIX: throttle re-renders to ~30fps. Previously every single
            // token triggered a full setConversations -> sidebar+list rerender,
            // which made the UI feel sluggish on local models. Sufficient
            // for human-visible smoothness.
            const now = Date.now();
            if (!streamThrottleRef.current || now - streamThrottleRef.current > 33) {
              streamThrottleRef.current = now;
              const snapshot = currentMsgs;
              setConversations(prev => prev.map(c => c.id === convId ? { ...c, messages: snapshot, updatedAt: now } : c));
            }
            return;
          }
          if (event.type === 'assistant_message') {
            const finalContent = normalizeAssistantText(event.message.content || '');
            const streamedContent = normalizeAssistantText(streamBufferRef.current || '');
            const content = streamedContent.length > finalContent.length && finalContent.length < 120
              ? streamedContent
              : finalContent;
            const assistantMsg: Message = {
              id: generateId(),
              role: 'assistant',
              content,
              tool_calls: event.message.tool_calls?.map((tc: any) => ({ ...tc, status: 'done' })),
              timestamp: Date.now()
            };
            streamBufferRef.current = '';
            // Streaming mesajı varsa əvəz et, yoxsa əlavə et
            const lastMsg = currentMsgs[currentMsgs.length - 1];
            if (lastMsg && lastMsg.role === 'assistant' && lastMsg.id?.startsWith('streaming_')) {
              currentMsgs = [...currentMsgs.slice(0, -1), assistantMsg];
            } else {
              currentMsgs = [...currentMsgs, assistantMsg];
            }
            
            // AUTO PORT DETECTION: Scan assistant message for new localhost URLs
            const msgContent = typeof event.message === 'string' ? event.message : (event.message.content || '');
            if (msgContent.includes('http://localhost:')) {
              const match = msgContent.match(/http:\/\/localhost:(\d+)/);
              if (match && match[1]) {
                const newPort = parseInt(match[1]);
                if (activeProject) {
                   setProjects(prev => prev.map(p => 
                     p.id === activeProject.id ? { ...p, lastPort: newPort } : p
                   ));
                }
              }
            }
            
            setConversations(prev => prev.map(c => c.id === convId ? { ...c, messages: currentMsgs, updatedAt: Date.now() } : c));
            if (serverBacked) updateConversationOnServer(convId, { messages: currentMsgs }).catch(console.error);
          } else if (event.type === 'tool_execution') {
            trackToolUse(event.tool);
            // IMMUTABLE UPDATE: Create a NEW messages array and NEW objects
            currentMsgs = currentMsgs.map((m, idx) => {
              if (idx === currentMsgs.length - 1 && m.role === 'assistant' && m.tool_calls) {
                return {
                  ...m,
                  tool_calls: m.tool_calls.map((tc: any) =>
                    (event.tool_call_id && tc.id === event.tool_call_id) || (!event.tool_call_id && tc.function.name === event.tool)
                      ? { ...tc, status: 'running' }
                      : tc
                  )
                };
              }
              return m;
            });
            setConversations(prev => prev.map(c => c.id === convId ? { ...c, messages: currentMsgs, updatedAt: Date.now() } : c));
            if (serverBacked) updateConversationOnServer(convId, { messages: currentMsgs }).catch(console.error);
          } else if (event.type === 'tool_result') {
            // IMMUTABLE UPDATE: Enrich the tool_call and add a NEW tool message
            let updatedToolCallId = '';
            currentMsgs = currentMsgs.map((m, idx) => {
              if (idx === currentMsgs.length - 1 && m.role === 'assistant' && m.tool_calls) {
                const updatedToolCalls = m.tool_calls.map((tc: any) => {
                  if (tc.status === 'running') {
                    updatedToolCallId = tc.id;
                    return { ...tc, status: 'done', result: event.result };
                  }
                  return tc;
                });
                return { ...m, tool_calls: updatedToolCalls };
              }
              return m;
            });

            const toolMsg: Message = {
              id: generateId(),
              role: 'tool',
              content: typeof event.result === 'string' ? event.result : JSON.stringify(event.result),
              tool_call_id: updatedToolCallId,
              timestamp: Date.now()
            };

            const repoProfile = typeof event.result === 'string'
              ? extractRepoProfileFromToolResult(event.result)
              : null;
            if (repoProfile && activeProject?.id) {
              const mergedMemory = mergeRepoProfileIntoMemory(projectMemory, repoProfile);
              setProjectMemory(mergedMemory);
              if (serverBacked) {
                saveProjectMemory(activeProject.id, mergedMemory).catch(console.error);
              }
            }

            const runningTool = currentMsgs
              .flatMap((message) => message.tool_calls || [])
              .find((toolCall: any) => toolCall.id === updatedToolCallId);
            if (runningTool?.function?.name && typeof event.result === 'string' && activeProject?.id) {
              const runtimeArtifact = extractRuntimeArtifact(
                runningTool.function.name,
                runningTool.function.arguments || '{}',
                event.result
              );
              if (runtimeArtifact) {
                const mergedMemory = mergeRuntimeArtifactIntoMemory(projectMemory, runtimeArtifact);
                setProjectMemory(mergedMemory);
                if (serverBacked) {
                  saveProjectMemory(activeProject.id, mergedMemory).catch(console.error);
                }
              }
            }
            if (runningTool?.function?.name === 'run_tests' && typeof event.result === 'string' && activeProject?.id) {
              const validation = buildValidationSnapshot(event.result);
              if (validation) {
                const mergedMemory = mergeValidationIntoMemory(projectMemory, validation);
                setProjectMemory(mergedMemory);
                if (serverBacked) {
                  saveProjectMemory(activeProject.id, mergedMemory).catch(console.error);
                }
              }
            }

            // AUTO PORT DETECTION: If terminal output contains a URL, update the project port
            if (typeof event.result === 'string' && event.result.includes('http://localhost:')) {
              const match = event.result.match(/http:\/\/localhost:(\d+)/);
              if (match && match[1]) {
                const newPort = parseInt(match[1]);
                // FIX: Use functional update to avoid stale projects state
                setProjects(prev => prev.map(p => 
                  p.id === activeProject?.id ? { ...p, lastPort: newPort } : p
                ));
              }
            }

            currentMsgs = [...currentMsgs, toolMsg];
            setConversations(prev => prev.map(c => c.id === convId ? { ...c, messages: currentMsgs, updatedAt: Date.now() } : c));
            if (serverBacked) updateConversationOnServer(convId, { messages: currentMsgs }).catch(console.error);
            setPreviewKey(prev => prev + 1);
          } else if (event.type === 'workspace_updated') {
            // SEC-Audit: Safe null check for activeProject
            if (activeProject) {
              updateProject(activeProject.id, { path: event.path });
            }
            setPreviewKey(k => k + 1);
          }
        },
        controller.signal
      );

      if (activeProject?.id && serverBacked) {
        const inferredMemory = {
          ...projectMemory,
          language: 'az',
          model: settings.model,
          latestPrompt: input,
          workspace: activeProject.path,
          ...(plannerArtifact ? { plannerArtifact } : {}),
          ...(executionArtifacts.length > 0 ? { executionArtifacts, lastExecutionArtifact: executionArtifacts[executionArtifacts.length - 1] } : {})
        };
        setProjectMemory(inferredMemory);
        saveProjectMemory(activeProject.id, inferredMemory).catch(console.error);
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        const errMsg: Message = { id: generateId(), role: 'assistant', content: `❌ Xəta: ${normalizeUiErrorMessage(err.message)}`, timestamp: Date.now() };
        setConversations(prev => prev.map(c => c.id === convId ? { ...c, messages: [...c.messages, errMsg], updatedAt: Date.now() } : c));
      }
    } finally { 
      setLoading(false); 
      setAbortController(null);
      // Track response time
      const responseTime = Date.now() - userMsg.timestamp;
      trackChatMessage(settings.model, responseTime);
    }
  }, [activeConvId, conversations, messages, settings, activeProject, updateProject, serverBacked, projectMemory, safeMode, plannerArtifact, executionArtifacts, abortController]);

  const decideApproval = useCallback(async (approvalId: string, decision: 'approve' | 'reject') => {
    await submitApproval(approvalId, decision);
    const targetApproval = pendingApprovals.find(item => item.approvalId === approvalId);
    if (targetApproval && activeProject?.id) {
      const mergedMemory = mergeApprovalDecisionIntoMemory(projectMemory, targetApproval, decision);
      setProjectMemory(mergedMemory);
      if (serverBacked) {
        saveProjectMemory(activeProject.id, mergedMemory).catch(console.error);
      }
    }
    // approval UI removal now comes from backend `approval_resolved` event
  }, [activeProject?.id, pendingApprovals, projectMemory, serverBacked]);

  const applySseEvent = useCallback((event: any, convId: string, currentMsgsRef: { current: Message[] }) => {
    let currentMsgs = currentMsgsRef.current;
    if (event.type === 'approval_request') {
      const approval = {
        approvalId: event.approvalId,
        tool: event.tool,
        args: event.args,
        conversationId: event.conversationId,
        runId: event.runId,
        phaseRole: event.phaseRole,
        expiresAt: event.expiresAt,
        meta: event.meta
      };
      setPendingApprovals(prev => [...prev, approval]);
      setActionCenterInteractions(prev => [
        ...prev.filter(item => item.id !== event.approvalId),
        { id: event.approvalId, kind: 'approval', approval }
      ]);
      return;
    }
    if (event.type === 'approval_resolved') {
      setPendingApprovals(prev => prev.filter(item => item.approvalId !== event.approvalId));
      setActionCenterInteractions(prev => {
        const resolved = prev.find(item => item.id === event.approvalId);
        if (resolved) {
          setActionCenterHistory(history => [resolved, ...history].slice(0, 12));
        }
        return prev.filter(item => item.id !== event.approvalId);
      });
      return;
    }
    if (event.type === 'human_checkpoint') {
      setHumanCheckpoint(event.checkpoint);
      setActionCenterInteractions(prev => [
        ...prev.filter(item => item.kind !== 'checkpoint'),
        { id: event.checkpoint.id, kind: 'checkpoint', checkpoint: event.checkpoint }
      ]);
      return;
    }
    if (event.type === 'assistant_message') {
      const assistantMsg: Message = {
        id: generateId(),
        role: 'assistant',
        content: normalizeAssistantText(event.message.content || ''),
        tool_calls: event.message.tool_calls?.map((tc: any) => ({ ...tc, status: 'done' })),
        timestamp: Date.now()
      };
      currentMsgs = [...currentMsgs, assistantMsg];
      currentMsgsRef.current = currentMsgs;
      setConversations(prev => prev.map(c => c.id === convId ? { ...c, messages: currentMsgs, updatedAt: Date.now() } : c));
      return;
    }
    if (event.type === 'tool_execution') {
      currentMsgs = currentMsgs.map((m, idx) => {
        if (idx === currentMsgs.length - 1 && m.role === 'assistant' && m.tool_calls) {
          return {
            ...m,
            tool_calls: m.tool_calls.map((tc: any) =>
              (event.tool_call_id && tc.id === event.tool_call_id) || (!event.tool_call_id && tc.function.name === event.tool)
                ? { ...tc, status: 'running' }
                : tc
            )
          };
        }
        return m;
      });
      currentMsgsRef.current = currentMsgs;
      setConversations(prev => prev.map(c => c.id === convId ? { ...c, messages: currentMsgs, updatedAt: Date.now() } : c));
      return;
    }
    if (event.type === 'tool_result') {
      let updatedToolCallId = '';
      currentMsgs = currentMsgs.map((m, idx) => {
        if (idx === currentMsgs.length - 1 && m.role === 'assistant' && m.tool_calls) {
          return {
            ...m,
            tool_calls: m.tool_calls.map((tc: any) => {
              if (tc.status === 'running') {
                updatedToolCallId = tc.id;
                return { ...tc, status: 'done', result: event.result };
              }
              return tc;
            })
          };
        }
        return m;
      });
      currentMsgs = [...currentMsgs, {
        id: generateId(),
        role: 'tool',
        content: typeof event.result === 'string' ? event.result : JSON.stringify(event.result),
        tool_call_id: updatedToolCallId,
        timestamp: Date.now()
      }];
      currentMsgsRef.current = currentMsgs;
      setConversations(prev => prev.map(c => c.id === convId ? { ...c, messages: currentMsgs, updatedAt: Date.now() } : c));
    }
  }, []);

  const resolveHumanCheckpoint = useCallback(async (decision: 'resume' | 'cancel') => {
    const checkpoint = humanCheckpoint;
    if (!checkpoint) return;
    setHumanCheckpoint(null);
    setActionCenterInteractions(prev => {
      const resolved = prev.find(item => item.id === checkpoint.id);
      if (resolved) {
        setActionCenterHistory(history => [resolved, ...history].slice(0, 12));
      }
      return prev.filter(item => item.id !== checkpoint.id);
    });
    if (decision === 'resume' || decision === 'cancel') {
      const convId = activeConvIdRef.current;
      if (!convId) return;
      const response = await resolveCheckpointRequest(checkpoint.id, decision, activeProject?.path || '');
      if (response && response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        const currentMsgsRef = {
          current: [...(conversations.find(c => c.id === convId)?.messages || [])]
        };
        let buffer = '';
        let done = false;
        while (!done) {
          const { value, done: readerDone } = await reader.read();
          done = readerDone;
          if (!value) continue;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const payload = line.slice(6);
            if (payload === '[DONE]') continue;
            try {
              applySseEvent(JSON.parse(payload), convId, currentMsgsRef);
            } catch {
              // ignore malformed chunks
            }
          }
        }
      }
    }
  }, [humanCheckpoint, activeProject?.path, conversations, applySseEvent]);

  const runHealthCheck = useCallback(async () => {
    if (!activeProject?.path) return;
    await runProjectHealthCheck(activeProject.path, (event) => {
      const detail = event.type === 'health_log'
        ? { type: 'info', content: String(event.chunk || '') }
        : { type: 'command', content: `[${String(event.type)}] ${String(event.key || '')} ${String(event.status || '')}` };
      window.dispatchEvent(new CustomEvent('terminal-log', { detail }));
    });
  }, [activeProject?.path]);

  const runTerminalCommand = useCallback(async (command: string) => {
    if (!activeProject?.path || !command) return;
    window.dispatchEvent(new CustomEvent('terminal-log', { detail: { type: 'command', content: command } }));
    await runTerminalStream(command, activeProject.path, (event) => {
      if (event.type === 'terminal_line') {
        window.dispatchEvent(new CustomEvent('terminal-log', {
          detail: {
            type: event.stream === 'stderr' ? 'error' : 'info',
            content: String(event.chunk || '')
          }
        }));
      }
      if (event.type === 'terminal_done') {
        window.dispatchEvent(new CustomEvent('terminal-log', {
          detail: {
            type: Number(event.code) === 0 ? 'success' : 'error',
            content: `Exit code: ${String(event.code)}`
          }
        }));
      }
    });
  }, [activeProject?.path]);

  const getDiffPreview = useCallback(async (filePath: string, newContent: string) => {
    if (!activeProject?.path) throw new Error('Project seçilməyib');
    return previewDiff({ path: filePath, workingDirectory: activeProject.path, newContent });
  }, [activeProject?.path]);

  const applyDiffPreview = useCallback(async (filePath: string, newContent: string) => {
    if (!activeProject?.path) throw new Error('Project seçilməyib');
    await applyDiff({ path: filePath, workingDirectory: activeProject.path, newContent });
  }, [activeProject?.path]);

  return {
    projects, conversations, messages, activeConvId, activeConversation, activeProject, loading, previewKey,
    safeMode, setSafeMode, taskPlan, pendingApprovals, humanCheckpoint, actionCenterInteractions, actionCenterHistory, projectMemory, plannerArtifact, executionArtifacts,
    sendMessage, stop: () => { abortController?.abort(); setLoading(false); },
    decideApproval, resolveHumanCheckpoint, runHealthCheck, runTerminalCommand, getDiffPreview, applyDiffPreview,
    setActiveConvId: (id: string | null) => {
      // When switching conversations, abort current request and reset loading
      if (id !== activeConvId) {
        if (abortController) {
          abortController.abort();
          setAbortController(null);
        }
        setLoading(false);
      }
      setActiveConvId(id);
    }, createProject, updateProject, archiveProject: (id: string, archived: boolean = true) => updateProject(id, { archived }),
    deleteProject: (id: string) => {
      setProjects(p => p.filter(x => x.id !== id));
      setConversations(c => c.filter(x => x.projectId !== id));
      if (serverBacked) deleteProjectOnServer(id).catch(console.error);
    },
    updateProjectPort: (port: number) => {
      if (activeProject) {
        setProjects(prev => prev.map(p => p.id === activeProject.id ? { ...p, lastPort: port } : p));
      }
    },
    createConversation,
    deleteConversation: (id: string) => {
      setConversations(c => c.filter(x => x.id !== id));
      if (serverBacked) deleteConversationOnServer(id).catch(console.error);
    },
    clearAll: () => { setConversations([]); setProjects([]); setActiveConvId(null); }
  };
}
