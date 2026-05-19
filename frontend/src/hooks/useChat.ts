// ==========================================
// useChat Hook — Fully Immutable & Audit-Safe
// ==========================================

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { Message, Conversation, Project, Settings } from '../lib/types';
import {
  applyDiff,
  createConversationOnServer,
  createProjectOnServer,
  deleteConversationOnServer,
  deleteProjectOnServer,
  extractAttachments,
  getProjectMemory,
  getTaskPlan,
  loadWorkspaceState,
  previewDiff,
  runProjectHealthCheck,
  runTerminalStream,
  saveProjectMemory,
  sendChatMessage,
  submitApproval,
  updateConversationOnServer,
  updateProjectOnServer
} from '../lib/api';

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

export function useChat(settings: Settings, userKey?: string | number | null) {
  const [projects, setProjects] = useState<Project[]>(() => loadFromStorage('projects', []));
  const [conversations, setConversations] = useState<Conversation[]>(() => loadFromStorage('conversations', []));
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [serverBacked, setServerBacked] = useState(false);
  const [abortController, setAbortController] = useState<AbortController | null>(null);
  const [previewKey, setPreviewKey] = useState(0);
  const [safeMode, setSafeMode] = useState(true);
  const [taskPlan, setTaskPlan] = useState<string[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<Array<{ approvalId: string; tool: string; args: string }>>([]);
  const [projectMemory, setProjectMemory] = useState<Record<string, unknown>>({});

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
        return;
      }
      try {
        const memory = await getProjectMemory(activeProject.id);
        setProjectMemory(memory);
      } catch {
        setProjectMemory({});
      }
    };
    loadMemory();
  }, [activeProject?.id, serverBacked]);

  const createConversation = useCallback((projectId: string, title: string = 'Yeni söhbət') => {
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
  }, [serverBacked]);

  const createProject = useCallback((name: string, path: string, repoUrl?: string) => {
    const newProj: Project = { id: generateId(), name, path, createdAt: Date.now(), repoUrl };
    const localConv: Conversation = {
      id: generateId(),
      projectId: newProj.id,
      title: repoUrl ? `Import: ${name}` : 'Analiz və Planlaşdırma',
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

    const enrichedAttachments = await extractAttachments(attachments);
    const userMsg: Message = { id: generateId(), role: 'user', content: input, attachments: enrichedAttachments, timestamp: Date.now() };
    
    // Add user message to state
    let currentMsgs = [...messages, userMsg];
    setConversations(prev => prev.map(c => c.id === activeConvId ? { ...c, messages: currentMsgs, updatedAt: Date.now() } : c));
    
    setLoading(true);
    setTaskPlan([]);
    const controller = new AbortController();
    setAbortController(controller);

    try {
      // Task plan arxa planda — chat-i bloklamır
      getTaskPlan(input, activeProject?.path || settings.projectDir)
        .then(plan => setTaskPlan(plan.items))
        .catch(() => setTaskPlan([]));

      const MAX_HISTORY_MESSAGES = 24;
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
        content: String(m.content || '').slice(0, 12000),
        // Prevent multi-megabyte payloads on every turn:
        // keep parsed attachment text, drop huge base64 data URLs.
        attachments: m.attachments?.map((at: any) => ({
          id: at.id,
          name: at.name,
          type: at.type,
          mimeType: at.mimeType,
          extractedText: at.extractedText || '',
          extractionError: at.extractionError,
          url: ''
        })),
        tool_calls: trimmedToolCalls,
        tool_call_id: m.tool_call_id
      })});

      await sendChatMessage(
        preparedMessages,
        settings.apiKey, settings.baseUrl, settings.model, activeProject?.path || settings.projectDir,
        { safeMode, projectId: activeProject?.id, conversationId: activeConvId },
        (event: any) => {
          if (event.type === 'task_plan') {
            setTaskPlan(Array.isArray(event.items) ? event.items : []);
            return;
          }
          if (event.type === 'error') {
            const errMsg: Message = { id: generateId(), role: 'assistant', content: `❌ Xəta: ${event.message}`, timestamp: Date.now() };
            currentMsgs = [...currentMsgs, errMsg];
            setConversations(prev => prev.map(c => c.id === activeConvId ? { ...c, messages: currentMsgs, updatedAt: Date.now() } : c));
            return;
          }
          if (event.type === 'approval_request') {
            setPendingApprovals(prev => [...prev, { approvalId: event.approvalId, tool: event.tool, args: event.args }]);
            return;
          }
          if (event.type === 'assistant_delta') {
            // Streaming — real-time mətn yeniləməsi
            const lastMsg = currentMsgs[currentMsgs.length - 1];
            if (lastMsg && lastMsg.role === 'assistant' && !lastMsg.tool_calls) {
              // Mövcud streaming mesajını yenilə
              const updatedMsg = { ...lastMsg, content: (lastMsg.content || '') + event.content };
              currentMsgs = [...currentMsgs.slice(0, -1), updatedMsg];
            } else {
              // Yeni streaming mesajı yarat
              const streamMsg: Message = {
                id: 'streaming_' + Date.now(),
                role: 'assistant',
                content: event.content,
                timestamp: Date.now()
              };
              currentMsgs = [...currentMsgs, streamMsg];
            }
            setConversations(prev => prev.map(c => c.id === activeConvId ? { ...c, messages: currentMsgs, updatedAt: Date.now() } : c));
            return;
          }
          if (event.type === 'assistant_message') {
            const assistantMsg: Message = {
              id: generateId(),
              role: 'assistant',
              content: event.message.content || '',
              tool_calls: event.message.tool_calls?.map((tc: any) => ({ ...tc, status: 'done' })),
              timestamp: Date.now()
            };
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
            
            setConversations(prev => prev.map(c => c.id === activeConvId ? { ...c, messages: currentMsgs, updatedAt: Date.now() } : c));
            if (serverBacked) updateConversationOnServer(activeConvId, { messages: currentMsgs }).catch(console.error);
          } else if (event.type === 'tool_execution') {
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
            setConversations(prev => prev.map(c => c.id === activeConvId ? { ...c, messages: currentMsgs, updatedAt: Date.now() } : c));
            if (serverBacked) updateConversationOnServer(activeConvId, { messages: currentMsgs }).catch(console.error);
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
            setConversations(prev => prev.map(c => c.id === activeConvId ? { ...c, messages: currentMsgs, updatedAt: Date.now() } : c));
            if (serverBacked) updateConversationOnServer(activeConvId, { messages: currentMsgs }).catch(console.error);
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
          workspace: activeProject.path
        };
        setProjectMemory(inferredMemory);
        saveProjectMemory(activeProject.id, inferredMemory).catch(console.error);
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        const errMsg: Message = { id: generateId(), role: 'assistant', content: `❌ Xəta: ${err.message}`, timestamp: Date.now() };
        setConversations(prev => prev.map(c => c.id === activeConvId ? { ...c, messages: [...c.messages, errMsg], updatedAt: Date.now() } : c));
      }
    } finally { setLoading(false); setAbortController(null); }
  }, [activeConvId, messages, settings, activeProject, updateProject, serverBacked, projectMemory, safeMode]);

  const decideApproval = useCallback(async (approvalId: string, decision: 'approve' | 'reject') => {
    await submitApproval(approvalId, decision);
    // Backend approval gözləyir və özü icra edir, burada executeApproval çağırmırıq
    setPendingApprovals(prev => prev.filter(item => item.approvalId !== approvalId));
  }, []);

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
    safeMode, setSafeMode, taskPlan, pendingApprovals, projectMemory,
    sendMessage, stop: () => { abortController?.abort(); setLoading(false); },
    decideApproval, runHealthCheck, runTerminalCommand, getDiffPreview, applyDiffPreview,
    setActiveConvId, createProject, updateProject, archiveProject: (id: string, archived: boolean = true) => updateProject(id, { archived }),
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
