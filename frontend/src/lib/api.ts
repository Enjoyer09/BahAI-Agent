// ==========================================
// Backend API Client
// ==========================================

import { API_BASE_URL } from './constants';
import type { SSEEvent } from './types';

function getAuthHeader() {
  const token = localStorage.getItem('auth_token');
  return token ? { 'Authorization': `Bearer ${token}` } : {};
}

export async function sendChatMessage(
  messages: Array<{ role: string; content: string }>,
  apiKey: string,
  baseUrl: string,
  model: string,
  workingDirectory: string,
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
