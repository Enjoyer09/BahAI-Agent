// ==========================================
// Backend API Client
// ==========================================

import { API_BASE_URL } from './constants';
import type { ActionCenterInteraction, Attachment, Conversation, GuiCapabilityStatus, Message, Project, SSEEvent } from './types';

function notifyAuthExpired(message = 'Sessiya vaxtı bitib. Yenidən daxil olun.') {
  try {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('refresh_token');
    localStorage.setItem('signed_out', '1');
    window.dispatchEvent(new CustomEvent('bahai-auth-expired', { detail: { message } }));
  } catch {
    // ignore
  }
}

function getAuthHeader() {
  const token = localStorage.getItem('auth_token');
  return token ? { 'Authorization': `Bearer ${token}` } : {};
}

let refreshRequest: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (refreshRequest) return refreshRequest;
  const refreshToken = localStorage.getItem('refresh_token');
  if (!refreshToken) return null;

  refreshRequest = fetch(`${API_BASE_URL}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  })
    .then(async (response) => {
      if (!response.ok) return null;
      const data = await response.json();
      if (!data?.token) return null;
      localStorage.setItem('auth_token', data.token);
      if (data.refreshToken) localStorage.setItem('refresh_token', data.refreshToken);
      return data.token as string;
    })
    .catch(() => null)
    .finally(() => {
      refreshRequest = null;
    });

  return refreshRequest;
}

async function isLocalMode(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/auth/config`, { cache: 'no-store' });
    if (!response.ok) return false;
    const data = await response.json();
    return data.localMode === true;
  } catch {
    return false;
  }
}

async function apiFetch(input: string, init: RequestInit = {}, retryOnLocalAuth = true, retryOnRefresh = true): Promise<Response> {
  const headers = new Headers(init.headers || {});
  const authHeader = getAuthHeader();
  for (const [key, value] of Object.entries(authHeader)) headers.set(key, value);

  const response = await fetch(input, { ...init, headers });
  if (response.status === 401) {
    if (retryOnRefresh) {
      const refreshedToken = await refreshAccessToken();
      if (refreshedToken) {
        const retryHeaders = new Headers(init.headers || {});
        retryHeaders.set('Authorization', `Bearer ${refreshedToken}`);
        return fetch(input, { ...init, headers: retryHeaders });
      }
    }
    notifyAuthExpired('Sessiya vaxtı bitib. Yenidən daxil olun.');
    return response;
  }
  if (response.status !== 403 || !retryOnLocalAuth) {
    if (response.status === 403) {
      const payload = await response.clone().json().catch(() => null);
      if (/sessiya vaxtı bitib|etibarsızdır/i.test(String(payload?.error || ''))) {
        notifyAuthExpired(String(payload.error || 'Sessiya vaxtı bitib. Yenidən daxil olun.'));
      }
    }
    return response;
  }

  if (!(await isLocalMode())) return response;
  localStorage.removeItem('auth_token');
  localStorage.removeItem('signed_out');

  const retryHeaders = new Headers(init.headers || {});
  return fetch(input, { ...init, headers: retryHeaders });
}

async function readError(response: Response, fallback: string): Promise<string> {
  const data = await response.json().catch(() => null);
  if (data?.error) return data.error;
  return fallback;
}

async function readErrorPayload(response: Response): Promise<{ error?: string; code?: string } | null> {
  return response.json().catch(() => null);
}

async function retryQueuedChatRequest(
  doFetch: () => Promise<Response>,
  attempts = 3
): Promise<Response> {
  let lastResponse: Response | null = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, 700 * attempt));
    }
    const response = await doFetch();
    if (response.ok) return response;
    if (response.status !== 409) return response;
    const payload = await readErrorPayload(response);
    const queueCode = payload?.code;
    if (queueCode !== 'CHAT_QUEUE_BUSY' && queueCode !== 'CHAT_QUEUE_DISCONNECTED') {
      return response;
    }
    lastResponse = new Response(JSON.stringify(payload), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    });
  }
  return lastResponse || doFetch();
}

export async function sendChatMessage(
  messages: Array<{ role: string; content: string; attachments?: Attachment[]; tool_calls?: unknown; tool_call_id?: string }>,
  apiKey: string,
  baseUrl: string,
  model: string,
  workingDirectory: string,
  options: { safeMode: boolean; projectId?: string | null; conversationId?: string | null; orchestrationMode?: boolean; workflow?: string; guiBrowserMode?: string; guiBrowserPath?: string; guiBrowserCdpUrl?: string; productMode?: 'web_chat' | 'desktop_code'; executionMode?: 'cloud' | 'local'; referentSummary?: Record<string, unknown> | null },
  onEvent: (event: SSEEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  if (model.startsWith('puter:') || model === 'puter') {
    onEvent({ type: 'assistant_message', message: { id: String(Date.now()), role: 'assistant', content: '' } });
    const puter = (window as any).puter;
    if (puter && puter.ai) {
      try {
        const puterModel = model.replace('puter:', '') || 'gpt-4o-mini';
        const lastMsg = messages[messages.length - 1]?.content || '';
        const res = await puter.ai.chat(lastMsg, { model: puterModel, stream: true });
        for await (const part of res) {
          const text = part?.text || part?.message?.content || part?.delta || '';
          if (typeof text === 'string' && text) {
            onEvent({ type: 'assistant_delta', content: text });
          }
        }
        return;
      } catch (err: any) {
        console.error('Puter AI client error:', err);
        throw new Error(`Puter AI xətası: ${err?.message || 'Cavab alınmadı'}`);
      }
    }
  }

  const requestBody = JSON.stringify({
    messages,
    apiKey,
    baseUrl,
    model,
    productMode: options.productMode,
    executionMode: options.executionMode,
    workingDirectory,
    safeMode: options.safeMode,
    projectId: options.projectId || undefined,
    conversationId: options.conversationId || undefined,
    orchestrationMode: options.orchestrationMode,
    workflow: options.workflow,
    guiBrowserMode: options.guiBrowserMode,
    guiBrowserPath: options.guiBrowserPath,
    guiBrowserCdpUrl: options.guiBrowserCdpUrl,
    referentSummary: options.referentSummary || undefined,
  });

  const doFetch = async () => apiFetch(`${API_BASE_URL}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: requestBody,
    signal,
  });

  let response: Response;
  const requestStartedAt = Date.now();
  try {
    response = await doFetch();
  } catch (err: any) {
    const isAbort = err?.name === 'AbortError';
    if (isAbort) throw err;

    // Retrying a chat POST can duplicate a long-running generation. Mobile
    // networks are especially prone to dropping an already accepted SSE
    // request, so only retry when the failure happened immediately.
    if (Date.now() - requestStartedAt > 2500) {
      const msg = err?.message || 'Network error';
      throw new Error(`Serverə qoşulmaq alınmadı. (${msg})`);
    }
    await new Promise((resolve) => setTimeout(resolve, 800));
    try {
      response = await doFetch();
    } catch (retryErr: any) {
      const msg = retryErr?.message || err?.message || 'Network error';
      throw new Error(`Serverə qoşulmaq alınmadı. Backend işləyirmi? (${API_BASE_URL}) — ${msg}`);
    }
  }

  if (!response.ok) {
    if (response.status === 401) throw new Error('Giriş tələb olunur. Zəhmət olmasa daxil olun.');
    if (response.status === 409) {
      const payload = await readErrorPayload(response);
      if (payload?.code === 'CHAT_QUEUE_BUSY' || payload?.code === 'CHAT_QUEUE_DISCONNECTED') {
        const retryResponse = await retryQueuedChatRequest(doFetch, 4);
        if (retryResponse.ok) {
          response = retryResponse;
        } else {
          const retryMsg = await readError(retryResponse, payload?.error || 'Sorğu hazırda icra oluna bilmir');
          throw new Error(retryMsg);
        }
      } else {
        const msg = payload?.error || 'Sorğu hazırda icra oluna bilmir';
        throw new Error(msg);
      }
    }
    if (!response.ok && response.status === 503) {
      const msg = await readError(response, 'Server məşğuldur');
      throw new Error(`${msg} Bir neçə saniyə sonra yenidən göndərin.`);
    }
    if (!response.ok) {
      const msg = await readError(response, `${response.status} ${response.statusText}`);
      throw new Error(`API xətası: ${msg}`);
    }
  }

  const reader = response.body?.getReader();
  const decoder = new TextDecoder();

  if (!reader) {
    throw new Error('Response body is empty');
  }

  let buffer = '';
  let done = false;
  let sawDoneMarker = false;
  let sawAnyEvent = false;
  let sawAssistantOutput = false;
  let sawFinalAssistantMessage = false;
  let sawStreamingAssistantDelta = false;
  let sawTerminalError = false;

  try {
    while (!done) {
      const { value, done: readerDone } = await reader.read();
      done = readerDone;

      if (value) {
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const dataStr = line.slice(6);
          if (dataStr === '[DONE]') {
            sawDoneMarker = true;
            continue;
          }
          try {
            const data = JSON.parse(dataStr) as SSEEvent;
            sawAnyEvent = true;
            if (data?.type === 'assistant_delta' || data?.type === 'assistant_message') {
              sawAssistantOutput = true;
            }
            if (data?.type === 'assistant_delta') {
              sawStreamingAssistantDelta = true;
            }
            if (data?.type === 'assistant_message') {
              sawFinalAssistantMessage = true;
            }
            if (data?.type === 'error') {
              sawTerminalError = true;
            }
            onEvent(data);
          } catch {
            // ignore
          }
        }
      }
    }
  } catch (err: any) {
    const message = String(err?.message || '');
    if (sawDoneMarker || sawAnyEvent || /network error|failed to fetch|load failed/i.test(message)) {
      if (!sawDoneMarker && sawAnyEvent && !signal?.aborted && !sawFinalAssistantMessage && !sawTerminalError) {
        onEvent({
          type: 'error',
          message: sawAssistantOutput
            ? (sawStreamingAssistantDelta
              ? 'Cavabın görünən hissəsi saxlanıldı. Qalan hissə yarımçıq kəsildi; davamı üçün yenidən göndərin.'
              : 'Cavab tamamlanmadan əlaqə kəsildi. Gələn hissə göstərildi; qalıq üçün yenidən göndərin.')
            : 'Cavab başlamadan əlaqə kəsildi. Yenidən cəhd edin.'
        } as SSEEvent);
      }
      return;
    }
    throw err;
  }

  if (buffer.startsWith('data: ')) {
    try {
      const payload = buffer.slice(6);
      if (payload === '[DONE]') {
        return;
      }
      const data = JSON.parse(payload) as SSEEvent;
      if (data?.type === 'assistant_delta' || data?.type === 'assistant_message') {
        sawAssistantOutput = true;
      }
      if (data?.type === 'assistant_delta') {
        sawStreamingAssistantDelta = true;
      }
      if (data?.type === 'assistant_message') {
        sawFinalAssistantMessage = true;
      }
      if (data?.type === 'error') {
        sawTerminalError = true;
      }
      onEvent(data);
    } catch {
      // ignore
    }
  }

  if (!sawDoneMarker && sawAnyEvent && !signal?.aborted && !sawFinalAssistantMessage && !sawTerminalError) {
    onEvent({
      type: 'error',
      message: sawAssistantOutput
        ? (sawStreamingAssistantDelta
          ? 'Cavabın görünən hissəsi saxlanıldı. Qalan hissə yarımçıq kəsildi; davamı üçün yenidən göndərin.'
          : 'Cavab tamamlanmadan əlaqə kəsildi. Gələn hissə göstərildi; qalıq üçün yenidən göndərin.')
        : 'Cavab yarımçıq dayandı. Yenidən cəhd edin.'
    } as SSEEvent);
  }
}

export async function loadWorkspaceState(input?: { limit?: number; offset?: number }): Promise<{ projects: Project[]; conversations: Conversation[]; pagination?: { limit: number; offset: number; hasMore: boolean } | null }> {
  const params = new URLSearchParams();
  if (typeof input?.limit === 'number') params.set('limit', String(input.limit));
  if (typeof input?.offset === 'number') params.set('offset', String(input.offset));
  const conversationsUrl = `${API_BASE_URL}/api/conversations${params.toString() ? `?${params.toString()}` : ''}`;
  const [projectsResponse, conversationsResponse] = await Promise.all([
    apiFetch(`${API_BASE_URL}/api/projects`),
    apiFetch(conversationsUrl)
  ]);
  if (!projectsResponse.ok || !conversationsResponse.ok) throw new Error('Workspace məlumatları yüklənmədi');
  const projectsData = await projectsResponse.json();
  const conversationsData = await conversationsResponse.json();
  return {
    projects: Array.isArray(projectsData.projects) ? projectsData.projects : [],
    conversations: Array.isArray(conversationsData.conversations) ? conversationsData.conversations : [],
    pagination: conversationsData.pagination || null,
  };
}

export async function listConversations(input?: { projectId?: string; limit?: number; offset?: number }): Promise<{ conversations: Conversation[]; pagination?: { limit: number; offset: number; hasMore: boolean } | null }> {
  const params = new URLSearchParams();
  if (input?.projectId) params.set('projectId', input.projectId);
  if (typeof input?.limit === 'number') params.set('limit', String(input.limit));
  if (typeof input?.offset === 'number') params.set('offset', String(input.offset));
  const response = await apiFetch(`${API_BASE_URL}/api/conversations${params.toString() ? `?${params.toString()}` : ''}`);
  if (!response.ok) throw new Error('Söhbətlər yüklənmədi');
  const data = await response.json();
  return {
    conversations: Array.isArray(data.conversations) ? data.conversations : [],
    pagination: data.pagination || null,
  };
}

export async function searchConversations(input: { q: string; projectId?: string; limit?: number; offset?: number }): Promise<{ conversations: Conversation[]; pagination?: { limit: number; offset: number; hasMore: boolean } | null }> {
  const params = new URLSearchParams();
  params.set('q', input.q);
  if (input.projectId) params.set('projectId', input.projectId);
  if (typeof input.limit === 'number') params.set('limit', String(input.limit));
  if (typeof input.offset === 'number') params.set('offset', String(input.offset));
  const response = await apiFetch(`${API_BASE_URL}/api/conversations?${params.toString()}`);
  if (!response.ok) throw new Error('Söhbət axtarışı alınmadı');
  const data = await response.json();
  return {
    conversations: Array.isArray(data.conversations) ? data.conversations : [],
    pagination: data.pagination || null,
  };
}

export async function getInstalledBrowsers(): Promise<{ browsers: Array<{ id: string; name: string; path: string; installed: boolean; supportsCdp: boolean; recommended?: boolean }>; cdpUrl: string; recommendedMode: string }> {
  const response = await apiFetch(`${API_BASE_URL}/api/browsers`);
  if (!response.ok) throw new Error('Browser siyahısı yüklənmədi');
  return await response.json();
}

export async function getGuiCapabilities(input?: {
  mode?: string;
  browserPath?: string;
  cdpUrl?: string;
}): Promise<GuiCapabilityStatus> {
  const params = new URLSearchParams();
  if (input?.mode) params.set('mode', input.mode);
  if (input?.browserPath) params.set('browserPath', input.browserPath);
  if (input?.cdpUrl) params.set('cdpUrl', input.cdpUrl);
  const query = params.toString();
  const response = await apiFetch(`${API_BASE_URL}/api/gui-capabilities${query ? `?${query}` : ''}`);
  if (!response.ok) throw new Error('GUI capability status yüklənmədi');
  return await response.json();
}

export async function getComputerUseStatus(): Promise<GuiCapabilityStatus['computerUse']> {
  const response = await apiFetch(`${API_BASE_URL}/api/computer-use-status`);
  if (!response.ok) throw new Error('Computer Use status yüklənmədi');
  return await response.json();
}

export async function getDesktopRuntimeStatus(input: {
  mode: 'cloud' | 'local';
  baseUrl?: string;
  model?: string;
}): Promise<{
  mode: string;
  baseUrl: string;
  model: string;
  ready: boolean;
  status: 'ok' | 'degraded' | 'missing' | 'unknown';
  summary: string;
  checks: Array<{ key: string; ok: boolean; detail: string }>;
}> {
  const params = new URLSearchParams();
  params.set('mode', input.mode);
  if (input.baseUrl) params.set('baseUrl', input.baseUrl);
  if (input.model) params.set('model', input.model);
  const response = await apiFetch(`${API_BASE_URL}/api/runtime-status?${params.toString()}`);
  if (!response.ok) throw new Error('Desktop runtime status yüklənmədi');
  return await response.json();
}

export async function getInteractions(): Promise<ActionCenterInteraction[]> {
  const response = await apiFetch(`${API_BASE_URL}/api/interactions`);
  if (!response.ok) throw new Error('Interaction-lar yüklənmədi');
  const data = await response.json();
  return Array.isArray(data.interactions) ? data.interactions : [];
}

export async function createProjectOnServer(input: { name: string; path: string; repoUrl?: string }): Promise<{ project: Project; conversation: Conversation }> {
  const response = await apiFetch(`${API_BASE_URL}/api/projects`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input)
  });
  if (!response.ok) throw new Error('Layihə yaradıla bilmədi');
  return await response.json();
}

export async function updateProjectOnServer(id: string, updates: Partial<Project>): Promise<Project> {
  const response = await apiFetch(`${API_BASE_URL}/api/projects/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(updates)
  });
  if (!response.ok) throw new Error('Layihə yenilənmədi');
  const data = await response.json();
  return data.project;
}

export async function deleteProjectOnServer(id: string): Promise<void> {
  const response = await apiFetch(`${API_BASE_URL}/api/projects/${encodeURIComponent(id)}`, {
    method: 'DELETE'
  });
  if (!response.ok) throw new Error('Layihə silinmədi');
}

export async function createConversationOnServer(projectId: string, title = 'Yeni söhbət'): Promise<Conversation> {
  const response = await apiFetch(`${API_BASE_URL}/api/conversations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ projectId, title })
  });
  if (!response.ok) throw new Error('Söhbət yaradıla bilmədi');
  const data = await response.json();
  return data.conversation;
}

export async function updateConversationOnServer(id: string, updates: Partial<Conversation>): Promise<Conversation> {
  const response = await apiFetch(`${API_BASE_URL}/api/conversations/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(updates)
  });
  if (!response.ok) throw new Error('Söhbət yenilənmədi');
  const data = await response.json();
  return data.conversation;
}

export async function deleteConversationOnServer(id: string): Promise<void> {
  const response = await apiFetch(`${API_BASE_URL}/api/conversations/${encodeURIComponent(id)}`, {
    method: 'DELETE'
  });
  if (!response.ok) throw new Error('Söhbət silinmədi');
}

export async function getConversationMessages(id: string, input?: { limit?: number; before?: string }): Promise<{ messages: Message[]; pagination?: { hasMore: boolean } | null }> {
  const params = new URLSearchParams();
  if (typeof input?.limit === 'number') params.set('limit', String(input.limit));
  if (input?.before) params.set('before', input.before);
  const response = await apiFetch(`${API_BASE_URL}/api/conversations/${encodeURIComponent(id)}/messages${params.toString() ? `?${params.toString()}` : ''}`);
  if (!response.ok) throw new Error('Söhbət mesajları yüklənmədi');
  const data = await response.json();
  return {
    messages: Array.isArray(data.messages) ? data.messages : [],
    pagination: data.pagination || null,
  };
}

export async function extractAttachments(attachments: Attachment[]): Promise<Attachment[]> {
  if (attachments.length === 0) return [];
  const images = attachments.filter((attachment) => attachment.type === 'image' || /^image\//i.test(attachment.mimeType || ''));
  const documents = attachments.filter((attachment) => !images.includes(attachment));
  // Vision-capable cloud models need the original image, not a slow OCR pass.
  if (documents.length === 0) return attachments;
  
  // Use AbortController with 120s timeout for large file processing
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120000);
  
  try {
    const response = await apiFetch(`${API_BASE_URL}/api/attachments/extract`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ attachments: documents }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      // Extraction failed — keep original attachments with URL so backend can retry
      console.warn('Attachment extraction failed:', response.status);
      return attachments.map(attachment => ({
        ...attachment,
        extractedText: attachment.type === 'image' ? attachment.extractedText : '',
        extractionError: attachment.type === 'image' ? attachment.extractionError : `Server xətası: ${response.status}`
      }));
    }
    const data = await response.json();
    const extracted = Array.isArray(data.attachments)
      ? data.attachments
      : Array.isArray(data.results)
        ? data.results
        : data.attachment
          ? [data.attachment]
          : [];
    return attachments.map(attachment => {
      if (images.includes(attachment)) return attachment;
      const match = extracted.find((item: Attachment) => item.id === attachment.id);
      if (match && match.extractedText) {
        // Extraction successful — keep extractedText, keep URL as backup
        return {
          ...attachment,
          ...match,
          url: attachment.url,
          imageUrl: attachment.type === 'image' ? attachment.url : match.imageUrl
        };
      }
      // Extraction returned empty — keep original URL for backend retry
      return {
        ...attachment,
        ...(match || {}),
        url: attachment.url,
        imageUrl: attachment.type === 'image' ? attachment.url : match?.imageUrl
      };
    });
  } catch (err: any) {
    clearTimeout(timeoutId);
    console.warn('Attachment extraction error:', err?.message);
    // On any error, keep original attachments with URL intact
    return attachments.map(attachment => ({
      ...attachment,
      extractedText: '',
      extractionError: err?.name === 'AbortError' 
        ? 'Fayl emalı vaxtı bitdi.' 
        : (err?.message || 'Extraction failed')
    }));
  }
}

export async function fetchFileTree(dirPath: string, workingDirectory: string): Promise<any[]> {
  const response = await apiFetch(`${API_BASE_URL}/api/files?path=${encodeURIComponent(dirPath)}&workingDirectory=${encodeURIComponent(workingDirectory)}`);
  if (!response.ok) throw new Error('Fayl siyahısı alına bilmədi. Giriş etdiyinizdən əmin olun.');
  return await response.json();
}

export async function pickDirectory(): Promise<string> {
  const response = await apiFetch(`${API_BASE_URL}/api/pick-directory`);
  if (!response.ok) throw new Error('Qovluq seçilə bilmədi');
  const data = await response.json();
  return data.path;
}

export async function getTaskPlan(prompt: string, workingDirectory: string): Promise<{ items: string[] }> {
  const response = await apiFetch(`${API_BASE_URL}/api/task-plan`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ prompt, workingDirectory })
  });
  if (!response.ok) throw new Error('Task plan yaradıla bilmədi');
  const data = await response.json();
  const items = Array.isArray(data.plan) ? data.plan.map((x: { title: string }) => x.title) : [];
  return { items };
}

export interface GithubStatus {
  connected: boolean;
  username: string | null;
}

export interface GithubRepo {
  id: number;
  name: string;
  fullName: string;
  private: boolean;
  cloneUrl: string;
  defaultBranch?: string;
}

export async function getGithubStatus(): Promise<GithubStatus> {
  const response = await apiFetch(`${API_BASE_URL}/api/github/status`);
  if (!response.ok) throw new Error('GitHub status alınmadı');
  return await response.json();
}

export async function connectGithub(token: string): Promise<GithubStatus> {
  const response = await apiFetch(`${API_BASE_URL}/api/github/connect`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ token })
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'GitHub qoşulmadı');
  }
  return await response.json();
}

export async function disconnectGithub(): Promise<void> {
  const response = await apiFetch(`${API_BASE_URL}/api/github/connect`, {
    method: 'DELETE'
  });
  if (!response.ok) throw new Error('GitHub ayrılmadı');
}

export async function listGithubRepos(): Promise<GithubRepo[]> {
  const response = await apiFetch(`${API_BASE_URL}/api/github/repos`);
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'GitHub repo siyahısı alınmadı');
  }
  const data = await response.json();
  return Array.isArray(data.repos) ? data.repos : [];
}

export async function previewDiff(input: { path: string; workingDirectory: string; newContent: string }): Promise<{ diff: string }> {
  const response = await apiFetch(`${API_BASE_URL}/api/diff/preview`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input)
  });
  if (!response.ok) throw new Error('Diff preview alınmadı');
  return await response.json();
}

export async function applyDiff(input: { path: string; workingDirectory: string; newContent: string }): Promise<void> {
  const response = await apiFetch(`${API_BASE_URL}/api/diff/apply`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input)
  });
  if (!response.ok) throw new Error('Diff tətbiq olunmadı');
}

async function streamSse(
  url: string,
  body: unknown,
  onEvent: (event: Record<string, unknown>) => void
): Promise<void> {
  const response = await apiFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`SSE xətası: ${response.status}`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error('SSE body boşdur');
  const decoder = new TextDecoder();
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
      try {
        onEvent(JSON.parse(line.slice(6)));
      } catch {
        // ignore invalid chunks
      }
    }
  }
}

export async function runTerminalStream(command: string, workingDirectory: string, onEvent: (event: Record<string, unknown>) => void): Promise<void> {
  await streamSse(`${API_BASE_URL}/api/terminal/run`, { command, workingDirectory }, onEvent);
}

export async function runProjectHealthCheck(workingDirectory: string, onEvent: (event: Record<string, unknown>) => void): Promise<void> {
  await streamSse(`${API_BASE_URL}/api/project-health`, { workingDirectory }, onEvent);
}

export async function getProjectMemory(projectId: string): Promise<Record<string, unknown>> {
  const response = await apiFetch(`${API_BASE_URL}/api/project-memory/${encodeURIComponent(projectId)}`);
  if (!response.ok) throw new Error('Project memory alınmadı');
  const data = await response.json();
  return data.memory || {};
}

export async function saveProjectMemory(projectId: string, memory: Record<string, unknown>): Promise<void> {
  const response = await apiFetch(`${API_BASE_URL}/api/project-memory/${encodeURIComponent(projectId)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ memory })
  });
  if (!response.ok) throw new Error('Project memory yazılmadı');
}

export async function submitApproval(approvalId: string, decision: 'approve' | 'reject'): Promise<void> {
  const response = await apiFetch(`${API_BASE_URL}/api/approvals/${encodeURIComponent(approvalId)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ decision })
  });
  if (!response.ok) throw new Error('Approval göndərilə bilmədi');
}

export async function resolveCheckpoint(
  checkpointId: string,
  decision: 'resume' | 'cancel',
  workingDirectory?: string
): Promise<Response | void> {
  const response = await apiFetch(`${API_BASE_URL}/api/checkpoints/${encodeURIComponent(checkpointId)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ decision, workingDirectory })
  });
  if (!response.ok) throw new Error('Checkpoint göndərilə bilmədi');
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('text/event-stream')) {
    return response;
  }
}
