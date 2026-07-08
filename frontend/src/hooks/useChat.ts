// ==========================================
// useChat Hook — Refactored (Reducer + Service)
// ==========================================

import { useReducer, useEffect, useCallback, useMemo, useRef } from 'react';
import type { Message, Conversation, Project, Settings, ApprovalRequest, PlannerArtifact, ExecutionArtifact } from '../lib/types';
import { trackChatMessage } from '../lib/telemetry';
import {
  loadFromStorage,
  createInitialState,
} from '../store/chatState';
import { chatReducer } from '../store/chatReducer';

import {
  handleSendMessage,
  loadWorkspace,
  listConversations,
  generateId,
  getDefaultConversationTitle,
  getDefaultWorkspaceName,
  getWelcomeMessage,
  buildConversationTitleFromInput,
  createProjectOnServer,
  updateProjectOnServer,
  deleteProjectOnServer,
  createConversationOnServer,
  updateConversationOnServer,
  deleteConversationOnServer,
  getProjectMemory,
  getInteractions,
  getGuiCapabilities,
  saveProjectMemory,
  submitApproval,
  resolveCheckpointRequest,
  runProjectHealthCheck,
  runTerminalStream,
  previewDiff,
  applyDiff,
} from '../store/chatService';
import { getConversationMessages, searchConversations } from '../lib/api';
import {
  mergeApprovalDecisionIntoMemory,
  mergeEvidenceSummaryIntoMemory,
  mergeGuiCapabilitiesIntoMemory,
  resolveActiveGuiSessionInMemory,
  isToolCallLikeText,
} from '../lib/chatRuntime';
import type { SendMessageContext } from '../store/chatService';

export function useChat(settings: Settings, userKey?: string | number | null) {
  const [state, dispatch] = useReducer(chatReducer, undefined, createInitialState);
  const activeConvIdRef = useRef<string | null>(null);
  const conversationsRef = useRef<Conversation[]>([]);
  const serverBackedRef = useRef<boolean>(false);
  const lastFinalAssistantContentRef = useRef<string>('');
  const streamThrottleRef = useRef<number>(0);
  const streamBufferRef = useRef<string>('');
  const storageTimeout = useRef<any>(null);
  const loadingOlderMessagesRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    activeConvIdRef.current = state.activeConvId;
  }, [state.activeConvId]);

  useEffect(() => {
    conversationsRef.current = state.conversations;
  }, [state.conversations]);

  useEffect(() => {
    serverBackedRef.current = state.serverBacked;
  }, [state.serverBacked]);

  // Reset on userKey change (cross-account bleed prevention)
  useEffect(() => {
    dispatch({ type: 'RESET_CHAT' });
    dispatch({ type: 'SET_SAFE_MODE', safeMode: loadFromStorage('safeMode', false) });
  }, [userKey]);

  // De-dupe safeMode persistence
  useEffect(() => {
    localStorage.setItem('safeMode', state.safeMode ? '1' : '0');
  }, [state.safeMode]);

  // ==========================================
  // Debounced Persistence
  // ==========================================
  useEffect(() => {
    if (state.serverBacked) return;
    if (storageTimeout.current) clearTimeout(storageTimeout.current);
    storageTimeout.current = setTimeout(() => {
      localStorage.setItem('projects', JSON.stringify(state.projects));
      localStorage.setItem('conversations', JSON.stringify(state.conversations));
    }, 500);
    return () => { if (storageTimeout.current) clearTimeout(storageTimeout.current); };
  }, [state.projects, state.conversations, state.serverBacked]);

  // ==========================================
  // Workspace Hydration
  // ==========================================
  useEffect(() => {
    if (!userKey) {
      dispatch({ type: 'SET_HYDRATED', hydrated: true });
      return;
    }
    let cancelled = false;
    const init = async () => {
      const result = await loadWorkspace(userKey, settings);
      if (cancelled) return;
      if (result.serverBacked) {
        dispatch({ type: 'SET_PROJECTS', projects: result.projects });
        dispatch({ type: 'SET_CONVERSATIONS', conversations: result.conversations });
        dispatch({ type: 'SET_CONVERSATIONS_HAS_MORE', hasMore: Boolean(result.conversationsHasMore) });
        dispatch({ type: 'SET_ACTIVE_CONV_ID', id: result.activeConvId });
        dispatch({ type: 'SET_SERVER_BACKED', backed: true });
      } else {
        const localProjects = loadFromStorage<Project[]>('projects', []);
        const localConvs = loadFromStorage<Conversation[]>('conversations', []);
        dispatch({ type: 'SET_PROJECTS', projects: localProjects });
        dispatch({ type: 'SET_CONVERSATIONS', conversations: localConvs });
        if (localConvs.length > 0) {
          dispatch({ type: 'SET_ACTIVE_CONV_ID', id: localConvs[0].id });
        }
      }
      if (!cancelled) dispatch({ type: 'SET_HYDRATED', hydrated: true });
    };
    init();
    return () => { cancelled = true; };
  }, [userKey]);

  // ==========================================
  // Auto-init Default Project & Conversation
  // ==========================================
  useEffect(() => {
    if (!state.hydrated || state.serverBacked) return;
    if (state.projects.length === 0) {
      const defaultProjId = generateId();
      const defaultProj: Project = {
        id: defaultProjId,
        name: getDefaultWorkspaceName(settings.productMode),
        path: 'workspace://default',
        createdAt: Date.now(),
      };
      const defaultConvId = generateId();
      const defaultConv: Conversation = {
        id: defaultConvId,
        projectId: defaultProjId,
        title: settings.productMode === 'web_chat' ? 'Yeni chat' : 'Xoş Gəlmisiniz!',
        messages: [{
          id: generateId(),
          role: 'assistant',
          content: getWelcomeMessage(settings.productMode, false),
          timestamp: Date.now(),
        }],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      dispatch({ type: 'SET_PROJECTS', projects: [defaultProj] });
      dispatch({ type: 'SET_CONVERSATIONS', conversations: [defaultConv] });
      dispatch({ type: 'SET_ACTIVE_CONV_ID', id: defaultConvId });
    } else if (!state.activeConvId && state.conversations.length > 0) {
      dispatch({ type: 'SET_ACTIVE_CONV_ID', id: state.conversations[0].id });
    }
  }, [state.hydrated, state.serverBacked, state.projects.length, state.conversations.length, state.activeConvId]);

  // ==========================================
  // Computed Values
  // ==========================================
  const activeConversation = useMemo(() =>
    state.conversations.find(c => c.id === state.activeConvId) || null,
    [state.conversations, state.activeConvId]
  );
  const messages = useMemo(() => activeConversation?.messages || [], [activeConversation]);
  const activeProject = useMemo(() =>
    state.projects.find(p => p.id === activeConversation?.projectId) || null,
    [state.projects, activeConversation]
  );

  // ==========================================
  // Project Memory Loading
  // ==========================================
  useEffect(() => {
    const loadMemory = async () => {
      if (!activeProject?.id || !state.serverBacked) {
        dispatch({ type: 'SET_PROJECT_MEMORY', memory: {} });
        dispatch({ type: 'SET_PLANNER_ARTIFACT', artifact: null });
        dispatch({ type: 'SET_EXECUTION_ARTIFACTS', artifacts: [] });
        return;
      }
      try {
        const memory = await getProjectMemory(activeProject.id);
        dispatch({ type: 'SET_PROJECT_MEMORY', memory });
        const savedArtifact = memory?.plannerArtifact;
        if (savedArtifact && typeof savedArtifact === 'object') {
          dispatch({ type: 'SET_PLANNER_ARTIFACT', artifact: savedArtifact as PlannerArtifact });
        } else {
          dispatch({ type: 'SET_PLANNER_ARTIFACT', artifact: null });
        }
        const savedExecutionArtifacts = Array.isArray(memory?.executionArtifacts) ? memory.executionArtifacts : [];
        dispatch({ type: 'SET_EXECUTION_ARTIFACTS', artifacts: savedExecutionArtifacts as ExecutionArtifact[] });
      } catch {
        dispatch({ type: 'SET_PROJECT_MEMORY', memory: {} });
        dispatch({ type: 'SET_PLANNER_ARTIFACT', artifact: null });
        dispatch({ type: 'SET_EXECUTION_ARTIFACTS', artifacts: [] });
      }
    };
    loadMemory();
  }, [activeProject?.id, state.serverBacked]);

  useEffect(() => {
    if (!state.serverBacked || !state.activeConvId) return;
    const active = state.conversations.find((conv) => conv.id === state.activeConvId);
    if (!active || active.messagesLoaded) return;
    let cancelled = false;
    getConversationMessages(active.id, { limit: 120 })
      .then((loadedPage: any) => {
        if (cancelled) return;
        const loadedMessages = Array.isArray(loadedPage?.messages) ? loadedPage.messages : [];
        dispatch({ type: 'SET_CONVERSATION_MESSAGES', id: active.id, messages: loadedMessages });
        dispatch({
          type: 'UPDATE_CONVERSATION',
          id: active.id,
          updates: {
            messagesLoaded: true,
            ...(loadedMessages.length > 0 ? {
              oldestMessageCursor: new Date(loadedMessages[0].timestamp).toISOString(),
              messagesHasMore: Boolean(loadedPage?.pagination?.hasMore)
            } : {})
          }
        });
      })
      .catch(() => {
        if (cancelled) return;
        dispatch({ type: 'UPDATE_CONVERSATION', id: active.id, updates: { messagesLoaded: true } });
      });
    return () => {
      cancelled = true;
    };
  }, [state.serverBacked, state.activeConvId, state.conversations]);

  // ==========================================
  // GUI Capabilities Loading
  // ==========================================
  useEffect(() => {
    let cancelled = false;
    const loadGuiCapabilities = async () => {
      try {
        const guiCapabilities = await getGuiCapabilities({
          mode: settings.guiBrowserMode,
          browserPath: settings.guiBrowserPath,
          cdpUrl: settings.guiBrowserCdpUrl,
        });
        if (cancelled) return;
        const merged = mergeGuiCapabilitiesIntoMemory(state.projectMemory, guiCapabilities);
        dispatch({ type: 'MERGE_PROJECT_MEMORY', memory: merged });
      } catch { /* silent */ }
    };
    loadGuiCapabilities();
    return () => { cancelled = true; };
  }, [settings.guiBrowserMode, settings.guiBrowserPath, settings.guiBrowserCdpUrl]);

  // ==========================================
  // Interactions Polling
  // ==========================================
  useEffect(() => {
    if (!state.serverBacked) {
      dispatch({ type: 'SET_INTERACTIONS', interactions: [] });
      return;
    }
    getInteractions()
      .then((items) => {
        dispatch({ type: 'SET_INTERACTIONS', interactions: items });
        const approvals = items
          .filter(item => item.kind === 'approval' && item.approval)
          .map(item => item.approval!) as ApprovalRequest[];
        const checkpoint = items.find(item => item.kind === 'checkpoint')?.checkpoint || null;
        dispatch({ type: 'SET_APPROVALS', approvals });
        dispatch({ type: 'SET_HUMAN_CHECKPOINT', checkpoint });
      })
      .catch(() => dispatch({ type: 'SET_INTERACTIONS', interactions: [] }));
  }, [state.serverBacked, state.activeConvId]);

  // ==========================================
  // Event Sink (bridge between SSE handler and reducer)
  // ==========================================
  const eventSink = useMemo(() => ({
    setTaskPlan: (items: string[]) => dispatch({ type: 'SET_TASK_PLAN', plan: items }),

    addSystemMessage: (content: string) => {
      const convId = activeConvIdRef.current;
      if (!convId) return;
      const msg: Message = { id: generateId(), role: 'system', content, timestamp: Date.now() };
      dispatch({ type: 'ADD_MESSAGE_TO_CONVERSATION', id: convId, message: msg });
    },

    updateAssistantMessage: (content: string) => {
      const convId = activeConvIdRef.current;
      if (!convId) return;
      if (isToolCallLikeText(content)) return;
      const now = Date.now();
      if (!streamThrottleRef.current || now - streamThrottleRef.current > 33) {
        streamThrottleRef.current = now;
        const conv = conversationsRef.current.find(c => c.id === convId);
        if (!conv) return;
        const msgs = [...conv.messages];
        const lastMsg = msgs[msgs.length - 1];
        if (lastMsg && lastMsg.role === 'assistant' && !lastMsg.tool_calls) {
          msgs[msgs.length - 1] = { ...lastMsg, content };
        } else {
          msgs.push({ id: 'streaming_' + now, role: 'assistant', content, timestamp: now });
        }
        dispatch({ type: 'SET_CONVERSATION_MESSAGES', id: convId, messages: msgs });
      }
    },

    finalizeAssistantMessage: (msg: Message) => {
      const convId = activeConvIdRef.current;
      if (!convId) return;
      const conv = conversationsRef.current.find(c => c.id === convId);
      if (!conv) return;
      const msgs = [...conv.messages];
      const lastMsg = msgs[msgs.length - 1];
      const normalizedIncoming = String(msg.content || '').trim();
      const normalizedLast = String(lastMsg?.content || '').trim();
      if (!normalizedIncoming && lastMsg && lastMsg.role === 'assistant' && lastMsg.id?.startsWith('streaming_')) {
        msgs.pop();
        dispatch({ type: 'SET_CONVERSATION_MESSAGES', id: convId, messages: msgs });
        if (serverBackedRef.current) {
          updateConversationOnServer(convId, { messages: msgs }).catch(console.error);
        }
        return;
      }
      if (
        msg.role === 'assistant' &&
        normalizedIncoming &&
        (
          normalizedIncoming === lastFinalAssistantContentRef.current ||
          (lastMsg?.role === 'assistant' && normalizedIncoming === normalizedLast)
        )
      ) {
        return;
      }
      if (lastMsg && lastMsg.role === 'assistant' && lastMsg.id?.startsWith('streaming_')) {
        msgs[msgs.length - 1] = msg;
      } else {
        msgs.push(msg);
      }
      if (msg.role === 'assistant') {
        lastFinalAssistantContentRef.current = normalizedIncoming;
      }
      dispatch({ type: 'SET_CONVERSATION_MESSAGES', id: convId, messages: msgs });
      if (serverBackedRef.current) {
        updateConversationOnServer(convId, { messages: msgs }).catch(console.error);
      }
    },

    updateToolExecution: (toolCallId: string | undefined, tool: string) => {
      const convId = activeConvIdRef.current;
      if (!convId) return;
      const conv = conversationsRef.current.find(c => c.id === convId);
      if (!conv) return;
      const msgs = conv.messages.map((m, idx) => {
        if (idx === conv.messages.length - 1 && m.role === 'assistant' && m.tool_calls) {
          return {
            ...m,
            tool_calls: m.tool_calls.map((tc: any) =>
              (toolCallId && tc.id === toolCallId) || (!toolCallId && tc.function?.name === tool)
                ? { ...tc, status: 'running' as const }
                : tc
            ),
          };
        }
        return m;
      });
      dispatch({ type: 'SET_CONVERSATION_MESSAGES', id: convId, messages: msgs });
      if (serverBackedRef.current) {
        updateConversationOnServer(convId, { messages: msgs }).catch(console.error);
      }
    },

    addToolResult: (toolMsg: Message, _updatedToolCallId: string) => {
      const convId = activeConvIdRef.current;
      if (!convId) return;
      const conv = conversationsRef.current.find(c => c.id === convId);
      if (!conv) return;
      const msgs = conv.messages.map((m, idx) => {
        if (idx === conv.messages.length - 1 && m.role === 'assistant' && m.tool_calls) {
          return {
            ...m,
            tool_calls: m.tool_calls.map((tc: any) =>
              tc.status === 'running' ? { ...tc, status: 'done' as const, result: toolMsg.content } : tc
            ),
          };
        }
        return m;
      });
      const nextMsgs = [...msgs, toolMsg];
      dispatch({ type: 'SET_CONVERSATION_MESSAGES', id: convId, messages: nextMsgs });
      if (serverBackedRef.current) {
        updateConversationOnServer(convId, { messages: nextMsgs }).catch(console.error);
      }
    },

    addApproval: (approval: ApprovalRequest) => {
      dispatch({ type: 'ADD_APPROVAL', approval });
      dispatch({
        type: 'ADD_INTERACTION',
        interaction: { id: approval.approvalId, kind: 'approval', approval },
      });
    },

    removeApproval: (approvalId: string) => {
      const interaction = state.actionCenterInteractions.find(i => i.id === approvalId);
      if (interaction) {
        dispatch({ type: 'ADD_INTERACTION_HISTORY', interaction });
      }
      dispatch({ type: 'REMOVE_APPROVAL', approvalId });
      dispatch({ type: 'REMOVE_INTERACTION', id: approvalId });
    },

    setHumanCheckpoint: (checkpoint: any) => {
      dispatch({ type: 'SET_HUMAN_CHECKPOINT', checkpoint });
      dispatch({
        type: 'ADD_INTERACTION',
        interaction: { id: checkpoint.id, kind: 'checkpoint', checkpoint },
      });
    },

    setPlannerArtifact: (artifact: PlannerArtifact) => {
      dispatch({ type: 'SET_PLANNER_ARTIFACT', artifact });
    },

    setExecutionArtifacts: (artifacts: ExecutionArtifact[]) => {
      dispatch({ type: 'SET_EXECUTION_ARTIFACTS', artifacts });
    },

    mergeProjectMemory: (memory: Record<string, unknown>) => {
      dispatch({ type: 'MERGE_PROJECT_MEMORY', memory });
    },

    updateProjectPort: (_projectId: string, port: number) => {
      if (activeProject) {
        dispatch({ type: 'UPDATE_PROJECT', id: activeProject.id, updates: { lastPort: port } });
      }
    },

    incrementPreviewKey: () => {
      dispatch({ type: 'INCREMENT_PREVIEW_KEY' });
    },
  }), [activeProject]);

  // ==========================================
  // sendMessage
  // ==========================================
  const sendMessageFn = useCallback(async (input: string, attachments: any[] = []) => {
    if (!input.trim() && attachments.length === 0) return;
    if (!state.activeConvId) return;

    if (state.abortController) {
      state.abortController.abort();
      dispatch({ type: 'SET_ABORT_CONTROLLER', controller: null });
    }

    const convId = state.activeConvId;
    const activeConv = state.conversations.find(c => c.id === convId) || null;
    const userMsg: Message = { id: generateId(), role: 'user', content: input, attachments, timestamp: Date.now() };
    const shouldAutoRenameConversation = activeConv && (
      !activeConv.title ||
      activeConv.title === 'Yeni söhbət' ||
      activeConv.title === 'Yeni chat'
    );
    const nextTitle = shouldAutoRenameConversation ? buildConversationTitleFromInput(input, settings.productMode) : activeConv?.title;

    // Add user message to conversation
    const currentMsgs = [...messages, userMsg];
    dispatch({ type: 'SET_CONVERSATION_MESSAGES', id: convId, messages: currentMsgs });
    if (shouldAutoRenameConversation && nextTitle) {
      dispatch({ type: 'UPDATE_CONVERSATION', id: convId, updates: { title: nextTitle } });
      if (state.serverBacked) {
        updateConversationOnServer(convId, { title: nextTitle, messages: currentMsgs }).catch(console.error);
      }
    }

    dispatch({ type: 'SET_LOADING', loading: true });
    dispatch({ type: 'SET_TASK_PLAN', plan: [] });
    dispatch({ type: 'SET_PLANNER_ARTIFACT', artifact: null });
    dispatch({ type: 'SET_EXECUTION_ARTIFACTS', artifacts: [] });
    streamBufferRef.current = '';
    lastFinalAssistantContentRef.current = '';

    const controller = new AbortController();
    dispatch({ type: 'SET_ABORT_CONTROLLER', controller });

    const ctx: SendMessageContext = {
      settings,
      activeConvId: convId,
      activeProject,
      messages: currentMsgs,
      projectMemory: state.projectMemory,
      plannerArtifact: state.plannerArtifact,
      executionArtifacts: state.executionArtifacts,
      serverBacked: state.serverBacked,
      safeMode: state.safeMode,
      sink: eventSink,
    };

    try {
      await handleSendMessage(input, attachments, ctx);
    } finally {
      dispatch({ type: 'SET_LOADING', loading: false });
      dispatch({ type: 'SET_ABORT_CONTROLLER', controller: null });
      const responseTime = Date.now() - userMsg.timestamp;
      trackChatMessage(settings.model, responseTime);
    }
  }, [state.activeConvId, state.conversations, state.abortController, state.projectMemory, state.plannerArtifact, state.executionArtifacts, state.serverBacked, state.safeMode, messages, activeProject, settings, eventSink]);

  // ==========================================
  // Callbacks
  // ==========================================
  const createConversation = useCallback((projectId: string, title: string = getDefaultConversationTitle(settings.productMode)) => {
    if (state.abortController) {
      state.abortController.abort();
      dispatch({ type: 'SET_ABORT_CONTROLLER', controller: null });
    }
    dispatch({ type: 'SET_LOADING', loading: false });

    const newConv: Conversation = {
      id: generateId(),
      projectId,
      title,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    dispatch({ type: 'ADD_CONVERSATION', conversation: newConv });
    dispatch({ type: 'SET_ACTIVE_CONV_ID', id: newConv.id });
    if (state.serverBacked) {
      createConversationOnServer(projectId, title)
        .then(serverConv => {
                dispatch({ type: 'UPDATE_CONVERSATION', id: newConv.id, updates: serverConv });
          dispatch({ type: 'SET_ACTIVE_CONV_ID', id: serverConv.id });
        })
        .catch(console.error);
    }
    return newConv.id;
  }, [state.serverBacked, state.abortController]);

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
    dispatch({ type: 'ADD_PROJECT', project: newProj });
    dispatch({ type: 'ADD_CONVERSATION', conversation: localConv });
    dispatch({ type: 'SET_ACTIVE_CONV_ID', id: localConv.id });
    if (state.serverBacked) {
      createProjectOnServer({ name, path, repoUrl })
        .then(({ project, conversation }) => {
          dispatch({ type: 'UPDATE_PROJECT', id: newProj.id, updates: project });
          dispatch({ type: 'UPDATE_CONVERSATION', id: localConv.id, updates: conversation });
          dispatch({ type: 'SET_ACTIVE_CONV_ID', id: conversation.id });
        })
        .catch(console.error);
    }
    return localConv.id;
  }, [state.serverBacked]);

  const updateProject = useCallback((id: string, updates: Partial<Project>) => {
    dispatch({ type: 'UPDATE_PROJECT', id, updates });
    if (state.serverBacked) updateProjectOnServer(id, updates).catch(console.error);
  }, [state.serverBacked]);

  const decideApproval = useCallback(async (approvalId: string, decision: 'approve' | 'reject') => {
    await submitApproval(approvalId, decision);
    const targetApproval = state.pendingApprovals.find(item => item.approvalId === approvalId);
    if (targetApproval && activeProject?.id) {
      const mergedMemory = mergeEvidenceSummaryIntoMemory(
        mergeApprovalDecisionIntoMemory(state.projectMemory, targetApproval, decision)
      );
      dispatch({ type: 'MERGE_PROJECT_MEMORY', memory: mergedMemory });
      if (state.serverBacked) {
        saveProjectMemory(activeProject.id, mergedMemory).catch(console.error);
      }
    }
  }, [activeProject?.id, state.pendingApprovals, state.projectMemory, state.serverBacked]);

  const resolveHumanCheckpoint = useCallback(async (decision: 'resume' | 'cancel') => {
    const checkpoint = state.humanCheckpoint;
    if (!checkpoint) return;
    dispatch({ type: 'SET_HUMAN_CHECKPOINT', checkpoint: null });
    const interaction = state.actionCenterInteractions.find(i => i.id === checkpoint.id);
    if (interaction) {
      dispatch({ type: 'ADD_INTERACTION_HISTORY', interaction });
    }
    dispatch({ type: 'REMOVE_INTERACTION', id: checkpoint.id });

    if (decision === 'resume' || decision === 'cancel') {
      if (activeProject?.id) {
        const mergedMemory = resolveActiveGuiSessionInMemory(state.projectMemory, decision);
        dispatch({ type: 'MERGE_PROJECT_MEMORY', memory: mergedMemory });
        if (state.serverBacked) {
          saveProjectMemory(activeProject.id, mergedMemory).catch(console.error);
        }
      }
      const convId = activeConvIdRef.current;
      if (!convId) return;
      const response = await resolveCheckpointRequest(checkpoint.id, decision, activeProject?.path || '');
      if (response && response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        const currentMsgsRef = { current: [...(state.conversations.find(c => c.id === convId)?.messages || [])] };
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
              const evt = JSON.parse(payload);
              // Apply SSE events during checkpoint resume
              if (evt.type === 'assistant_message') {
                const msg: Message = {
                  id: generateId(), role: 'assistant',
                  content: evt.message.content || '',
                  tool_calls: evt.message.tool_calls?.map((tc: any) => ({ ...tc, status: 'done' })),
                  timestamp: Date.now(),
                };
                currentMsgsRef.current = [...currentMsgsRef.current, msg];
                dispatch({ type: 'SET_CONVERSATION_MESSAGES', id: convId, messages: currentMsgsRef.current });
              } else if (evt.type === 'tool_execution') {
                const msgs = currentMsgsRef.current.map((m, idx) => {
                  if (idx === currentMsgsRef.current.length - 1 && m.role === 'assistant' && m.tool_calls) {
                    return {
                      ...m,
                      tool_calls: m.tool_calls.map((tc: any) =>
                        (evt.tool_call_id && tc.id === evt.tool_call_id) || (!evt.tool_call_id && tc.function?.name === evt.tool)
                          ? { ...tc, status: 'running' }
                          : tc
                      ),
                    };
                  }
                  return m;
                });
                currentMsgsRef.current = msgs;
                dispatch({ type: 'SET_CONVERSATION_MESSAGES', id: convId, messages: msgs });
              } else if (evt.type === 'tool_result') {
                const toolMsg: Message = {
                  id: generateId(), role: 'tool',
                  content: typeof evt.result === 'string' ? evt.result : JSON.stringify(evt.result),
                  tool_call_id: '',
                  timestamp: Date.now(),
                };
                currentMsgsRef.current = [...currentMsgsRef.current, toolMsg];
                dispatch({ type: 'SET_CONVERSATION_MESSAGES', id: convId, messages: currentMsgsRef.current });
              }
            } catch { /* ignore */ }
          }
        }
      }
    }
  }, [state.humanCheckpoint, state.actionCenterInteractions, activeProject?.id, activeProject?.path, state.conversations, state.projectMemory, state.serverBacked]);

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
          detail: { type: event.stream === 'stderr' ? 'error' : 'info', content: String(event.chunk || '') },
        }));
      }
      if (event.type === 'terminal_done') {
        window.dispatchEvent(new CustomEvent('terminal-log', {
          detail: { type: Number(event.code) === 0 ? 'success' : 'error', content: `Exit code: ${String(event.code)}` },
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

  // ==========================================
  // Return Value (backward-compatible API)
  // ==========================================
  return {
    projects: state.projects,
    conversations: state.conversations,
    conversationsHasMore: state.conversationsHasMore,
    messages,
    activeConvId: state.activeConvId,
    activeConversation,
    activeProject,
    loading: state.loading,
    loadingOlderMessages: activeConversation ? loadingOlderMessagesRef.current.has(activeConversation.id) : false,
    previewKey: state.previewKey,
    safeMode: state.safeMode,
    setSafeMode: (v: boolean) => dispatch({ type: 'SET_SAFE_MODE', safeMode: v }),
    taskPlan: state.taskPlan,
    pendingApprovals: state.pendingApprovals,
    humanCheckpoint: state.humanCheckpoint,
    actionCenterInteractions: state.actionCenterInteractions,
    actionCenterHistory: state.actionCenterHistory,
    projectMemory: state.projectMemory,
    plannerArtifact: state.plannerArtifact,
    executionArtifacts: state.executionArtifacts,
    sendMessage: sendMessageFn,
    stop: () => { state.abortController?.abort(); dispatch({ type: 'SET_LOADING', loading: false }); },
    decideApproval,
    resolveHumanCheckpoint,
    runHealthCheck,
    runTerminalCommand,
    getDiffPreview,
    applyDiffPreview,
    setActiveConvId: (id: string | null) => {
      if (id !== state.activeConvId) {
        if (state.abortController) {
          state.abortController.abort();
          dispatch({ type: 'SET_ABORT_CONTROLLER', controller: null });
        }
        dispatch({ type: 'SET_LOADING', loading: false });
      }
      dispatch({ type: 'SET_ACTIVE_CONV_ID', id });
    },
    createProject,
    updateProject,
    archiveProject: (id: string, archived: boolean = true) => updateProject(id, { archived }),
    deleteProject: (id: string) => {
      dispatch({ type: 'REMOVE_PROJECT', id });
      if (state.serverBacked) deleteProjectOnServer(id).catch(console.error);
    },
    updateProjectPort: (port: number) => {
      if (activeProject) {
        dispatch({ type: 'UPDATE_PROJECT', id: activeProject.id, updates: { lastPort: port } });
      }
    },
    createConversation,
    loadMoreConversations: async () => {
      if (!state.serverBacked || !state.conversationsHasMore) return;
      const result = await listConversations({ limit: 40, offset: state.conversations.length });
      dispatch({ type: 'APPEND_CONVERSATIONS', conversations: result.conversations, hasMore: Boolean(result.pagination?.hasMore) });
    },
    searchConversations: async (q: string) => {
      if (!state.serverBacked) return;
      const text = q.trim();
      if (!text) {
        const result = await loadWorkspace(userKey, settings);
        dispatch({ type: 'SET_CONVERSATIONS', conversations: result.conversations });
        dispatch({ type: 'SET_CONVERSATIONS_HAS_MORE', hasMore: Boolean(result.conversationsHasMore) });
        return;
      }
      const result = await searchConversations({ q: text, limit: 40, offset: 0 });
      dispatch({ type: 'SET_CONVERSATIONS', conversations: result.conversations });
      dispatch({ type: 'SET_CONVERSATIONS_HAS_MORE', hasMore: Boolean(result.pagination?.hasMore) });
    },
    loadOlderMessages: async (conversationId: string) => {
      const conv = state.conversations.find((item) => item.id === conversationId);
      if (!state.serverBacked || !conv || !conv.messagesHasMore || !conv.oldestMessageCursor) return;
      if (loadingOlderMessagesRef.current.has(conversationId)) return;
      loadingOlderMessagesRef.current.add(conversationId);
      dispatch({ type: 'SET_LOADING', loading: state.loading });
      try {
        const page = await getConversationMessages(conversationId, { limit: 80, before: conv.oldestMessageCursor });
        const older = Array.isArray(page.messages) ? page.messages : [];
        if (older.length === 0) {
          dispatch({
            type: 'UPDATE_CONVERSATION',
            id: conversationId,
            updates: { messagesHasMore: false }
          });
          return;
        }
        dispatch({ type: 'SET_CONVERSATION_MESSAGES', id: conversationId, messages: [...older, ...(conv.messages || [])] });
        dispatch({
          type: 'UPDATE_CONVERSATION',
          id: conversationId,
          updates: {
            oldestMessageCursor: new Date(older[0].timestamp).toISOString(),
            messagesHasMore: Boolean(page.pagination?.hasMore)
          }
        });
      } finally {
        loadingOlderMessagesRef.current.delete(conversationId);
        dispatch({ type: 'SET_LOADING', loading: state.loading });
      }
    },
    deleteConversation: (id: string) => {
      dispatch({ type: 'REMOVE_CONVERSATION', id });
      if (state.serverBacked) deleteConversationOnServer(id).catch(console.error);
    },
    clearAll: () => dispatch({ type: 'RESET_CHAT' }),
  };
}
