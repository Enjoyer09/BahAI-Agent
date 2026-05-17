// ==========================================
// Backend API Client
// ==========================================

import { API_BASE_URL } from './constants';
import type { Attachment, Conversation, Project, SSEEvent } from './types';

function getAuthHeader() {
  const token = localStorage.getItem('auth_token');
  return token ? { 'Authorization': `Bearer ${token}` } : {};
}

export async function sendChatMessage(
  messages: Array<{ role: string; content: string; attachments?: Attachment[]; tool_calls?: unknown; tool_call_id?: string }>,
  apiKey: string,
  baseUrl: string,
  model: string,
  workingDirectory: string,
  options: { safeMode: boolean; projectId?: string | null },
  onEvent: (event: SSEEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      ...getAuthHeader()
    },
    body: JSON.stringify({
      messages,
      apiKey,
      baseUrl,
      model,
      workingDirectory,
      safeMode: options.safeMode,
      projectId: options.projectId || undefined,
    }),
    signal,
  });

  if (!response.ok) {
    if (response.status === 401) throw new Error('Giriş tələb olunur. Zəhmət olmasa daxil olun.');
    throw new Error(`API xətası: ${response.status} ${response.statusText}`);
  }

  const reader = response.body?.getReader();
  const decoder = new TextDecoder();

  if (!reader) {
    throw new Error('Response body is empty');
  }

  let buffer = '';
  let done = false;

  while (!done) {
    const { value, done: readerDone } = await reader.read();
    done = readerDone;

    if (value) {
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const dataStr = line.slice(6);
          try {
            const data = JSON.parse(dataStr) as SSEEvent;
            onEvent(data);
          } catch {
            // ignore
          }
        }
      }
    }
  }

  if (buffer.startsWith('data: ')) {
    try {
      const data = JSON.parse(buffer.slice(6)) as SSEEvent;
      onEvent(data);
    } catch {
      // ignore
    }
  }
}

export async function loadWorkspaceState(): Promise<{ projects: Project[]; conversations: Conversation[] }> {
  const response = await fetch(`${API_BASE_URL}/api/projects`, {
    headers: getAuthHeader()
  });
  if (!response.ok) throw new Error('Workspace məlumatları yüklənmədi');
  return await response.json();
}

export async function createProjectOnServer(input: { name: string; path: string; repoUrl?: string }): Promise<{ project: Project; conversation: Conversation }> {
  const response = await fetch(`${API_BASE_URL}/api/projects`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeader()
    },
    body: JSON.stringify(input)
  });
  if (!response.ok) throw new Error('Layihə yaradıla bilmədi');
  return await response.json();
}

export async function updateProjectOnServer(id: string, updates: Partial<Project>): Promise<Project> {
  const response = await fetch(`${API_BASE_URL}/api/projects/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeader()
    },
    body: JSON.stringify(updates)
  });
  if (!response.ok) throw new Error('Layihə yenilənmədi');
  const data = await response.json();
  return data.project;
}

export async function deleteProjectOnServer(id: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/projects/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: getAuthHeader()
  });
  if (!response.ok) throw new Error('Layihə silinmədi');
}

export async function createConversationOnServer(projectId: string, title = 'Yeni söhbət'): Promise<Conversation> {
  const response = await fetch(`${API_BASE_URL}/api/conversations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeader()
    },
    body: JSON.stringify({ projectId, title })
  });
  if (!response.ok) throw new Error('Söhbət yaradıla bilmədi');
  const data = await response.json();
  return data.conversation;
}

export async function updateConversationOnServer(id: string, updates: Partial<Conversation>): Promise<Conversation> {
  const response = await fetch(`${API_BASE_URL}/api/conversations/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeader()
    },
    body: JSON.stringify(updates)
  });
  if (!response.ok) throw new Error('Söhbət yenilənmədi');
  const data = await response.json();
  return data.conversation;
}

export async function deleteConversationOnServer(id: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/conversations/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: getAuthHeader()
  });
  if (!response.ok) throw new Error('Söhbət silinmədi');
}

export async function extractAttachments(attachments: Attachment[]): Promise<Attachment[]> {
  if (attachments.length === 0) return [];
  const response = await fetch(`${API_BASE_URL}/api/attachments/extract`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeader()
    },
    body: JSON.stringify({ attachments })
  });
  if (!response.ok) return attachments;
  const data = await response.json();
  const extracted = Array.isArray(data.attachments) ? data.attachments : [];
  return attachments.map(attachment => {
    const match = extracted.find((item: Attachment) => item.id === attachment.id);
    return match ? { ...attachment, ...match } : attachment;
  });
}

export async function fetchFileTree(dirPath: string, workingDirectory: string): Promise<any[]> {
  const response = await fetch(`${API_BASE_URL}/api/files?path=${encodeURIComponent(dirPath)}&workingDirectory=${encodeURIComponent(workingDirectory)}`, {
    headers: getAuthHeader()
  });
  if (!response.ok) throw new Error('Fayl siyahısı alına bilmədi. Giriş etdiyinizdən əmin olun.');
  return await response.json();
}

export async function pickDirectory(): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/api/pick-directory`, {
    headers: getAuthHeader()
  });
  if (!response.ok) throw new Error('Qovluq seçilə bilmədi');
  const data = await response.json();
  return data.path;
}

export async function getTaskPlan(prompt: string, workingDirectory: string): Promise<{ items: string[] }> {
  const response = await fetch(`${API_BASE_URL}/api/task-plan`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeader()
    },
    body: JSON.stringify({ prompt, workingDirectory })
  });
  if (!response.ok) throw new Error('Task plan yaradıla bilmədi');
  const data = await response.json();
  const items = Array.isArray(data.plan) ? data.plan.map((x: { title: string }) => x.title) : [];
  return { items };
}

export async function previewDiff(input: { path: string; workingDirectory: string; newContent: string }): Promise<{ diff: string }> {
  const response = await fetch(`${API_BASE_URL}/api/diff/preview`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeader()
    },
    body: JSON.stringify(input)
  });
  if (!response.ok) throw new Error('Diff preview alınmadı');
  return await response.json();
}

export async function applyDiff(input: { path: string; workingDirectory: string; newContent: string }): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/diff/apply`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeader()
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
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeader()
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
  const response = await fetch(`${API_BASE_URL}/api/project-memory/${encodeURIComponent(projectId)}`, {
    headers: getAuthHeader()
  });
  if (!response.ok) throw new Error('Project memory alınmadı');
  const data = await response.json();
  return data.memory || {};
}

export async function saveProjectMemory(projectId: string, memory: Record<string, unknown>): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/project-memory/${encodeURIComponent(projectId)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeader()
    },
    body: JSON.stringify({ memory })
  });
  if (!response.ok) throw new Error('Project memory yazılmadı');
}

export async function submitApproval(approvalId: string, decision: 'approve' | 'reject'): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/approvals/${encodeURIComponent(approvalId)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeader()
    },
    body: JSON.stringify({ decision })
  });
  if (!response.ok) throw new Error('Approval göndərilə bilmədi');
}

export async function executeApproval(approvalId: string): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/api/approvals/${encodeURIComponent(approvalId)}/execute`, {
    method: 'POST',
    headers: getAuthHeader()
  });
  if (!response.ok) throw new Error('Approval icra olunmadı');
  const data = await response.json();
  return data.result || '';
}
