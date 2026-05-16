// ==========================================
// useChat Hook — Fully Audit-Compliant
// ==========================================

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { Message, Conversation, Project, Settings } from '../lib/types';
import { sendChatMessage } from '../lib/api';

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const saved = localStorage.getItem(key);
    if (!saved) return fallback;
    return JSON.parse(saved);
  } catch (e) {
    return fallback;
  }
}

export function useChat(settings: Settings) {
  const [projects, setProjects] = useState<Project[]>(() => loadFromStorage('projects', []));
  const [conversations, setConversations] = useState<Conversation[]>(() => loadFromStorage('conversations', []));
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [abortController, setAbortController] = useState<AbortController | null>(null);
  const [previewKey, setPreviewKey] = useState(0); // NEW: For live reload

  // PERF-1: Debounced Persistence
  const storageTimeout = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (storageTimeout.current) clearTimeout(storageTimeout.current);
    storageTimeout.current = setTimeout(() => {
      localStorage.setItem('projects', JSON.stringify(projects));
      localStorage.setItem('conversations', JSON.stringify(conversations));
    }, 500);
    return () => { if (storageTimeout.current) clearTimeout(storageTimeout.current); };
  }, [projects, conversations]);

  const activeConversation = useMemo(() => 
    conversations.find(c => c.id === activeConvId) || null
  , [conversations, activeConvId]);

  const messages = useMemo(() => activeConversation?.messages || [], [activeConversation]);

  const activeProject = useMemo(() => 
    projects.find(p => p.id === activeConversation?.projectId) || null
  , [projects, activeConversation]);

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
    return newConv.id;
  }, []);

  const createProject = useCallback((name: string, path: string, repoUrl?: string) => {
    const newProj: Project = { id: generateId(), name, path, createdAt: Date.now(), repoUrl };
    setProjects(prev => [...prev, newProj]);
    return createConversation(newProj.id, repoUrl ? `Import: ${name}` : 'Analiz və Planlaşdırma');
  }, [createConversation]);

  const updateProject = useCallback((id: string, updates: Partial<Project>) => {
    setProjects(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
  }, []);

  const sendMessage = useCallback(async (input: string, attachments: any[] = []) => {
    if (!input.trim() && attachments.length === 0) return;
    if (!settings.apiKey || !activeConvId) return;

    const userMsg: Message = { id: generateId(), role: 'user', content: input, attachments, timestamp: Date.now() };
    let currentMsgs = [...messages, userMsg];
    setConversations(prev => prev.map(c => c.id === activeConvId ? { ...c, messages: currentMsgs, updatedAt: Date.now() } : c));
    
    setLoading(true);
    const controller = new AbortController();
    setAbortController(controller);

    try {
      await sendChatMessage(
        currentMsgs.map(m => ({ 
          role: m.role, 
          content: m.content || '', 
          tool_calls: m.tool_calls, 
          tool_call_id: m.tool_call_id 
        })),
        settings.apiKey, settings.baseUrl, settings.model, activeProject?.path || settings.projectDir,
        (event: any) => {
          if (event.type === 'assistant_message') {
            const assistantMsg: Message = { 
              id: generateId(), 
              role: 'assistant', 
              content: event.message.content || '', 
              tool_calls: event.message.tool_calls?.map((tc: any) => ({ ...tc, status: 'done' })),
              timestamp: Date.now() 
            };
            currentMsgs = [...currentMsgs, assistantMsg];
            setConversations(prev => prev.map(c => c.id === activeConvId ? { ...c, messages: currentMsgs, updatedAt: Date.now() } : c));
          } else if (event.type === 'tool_execution') {
            const lastMsg = currentMsgs[currentMsgs.length - 1];
            if (lastMsg && lastMsg.role === 'assistant' && lastMsg.tool_calls) {
              lastMsg.tool_calls = lastMsg.tool_calls.map((tc: any) => 
                tc.function.name === event.tool ? { ...tc, status: 'running' } : tc
              );
              setConversations(prev => prev.map(c => c.id === activeConvId ? { ...c, messages: [...currentMsgs], updatedAt: Date.now() } : c));
            }
          } else if (event.type === 'tool_result') {
            const lastMsg = currentMsgs[currentMsgs.length - 1];
            if (lastMsg && lastMsg.role === 'assistant' && lastMsg.tool_calls) {
               lastMsg.tool_calls = lastMsg.tool_calls.map((tc: any) => 
                 tc.status === 'running' ? { ...tc, status: 'done', result: event.result } : tc
               );

               const toolMsg: Message = {
                 id: generateId(),
                 role: 'tool',
                 content: typeof event.result === 'string' ? event.result : JSON.stringify(event.result),
                 tool_call_id: lastMsg.tool_calls.find((tc: any) => tc.status === 'done' && tc.result === event.result)?.id || '',
                 timestamp: Date.now()
               };
               currentMsgs = [...currentMsgs, toolMsg];
               setConversations(prev => prev.map(c => c.id === activeConvId ? { ...c, messages: [...currentMsgs], updatedAt: Date.now() } : c));
            }
          } else if (event.type === 'workspace_updated') {
            updateProject(activeProject!.id, { path: event.path });
            setPreviewKey(k => k + 1); // TRIGGER RELOAD
          }
        },
        controller.signal
      );
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        const errMsg: Message = { id: generateId(), role: 'assistant', content: `❌ Xəta: ${err.message}`, timestamp: Date.now() };
        setConversations(prev => prev.map(c => c.id === activeConvId ? { ...c, messages: [...c.messages, errMsg], updatedAt: Date.now() } : c));
      }
    } finally { setLoading(false); setAbortController(null); }
  }, [activeConvId, messages, settings, activeProject, updateProject]);

  return {
    projects, conversations, messages, activeConvId, activeConversation, activeProject, loading, previewKey,
    sendMessage, stop: () => { abortController?.abort(); setLoading(false); },
    setActiveConvId, createProject, updateProject, archiveProject: (id: string, archived: boolean = true) => updateProject(id, { archived }),
    deleteProject: (id: string) => { setProjects(p => p.filter(x => x.id !== id)); setConversations(c => c.filter(x => x.projectId !== id)); },
    createConversation, deleteConversation: (id: string) => setConversations(c => c.filter(x => x.id !== id)),
    clearAll: () => { setConversations([]); setProjects([]); setActiveConvId(null); }
  };
}
