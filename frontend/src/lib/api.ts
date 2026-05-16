// ==========================================
// Backend API Client
// ==========================================

import { API_BASE_URL } from './constants';
import type { SSEEvent } from './types';

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
    headers: { 'Content-Type': 'application/json' },
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
      // Keep the last potentially incomplete chunk in the buffer
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const dataStr = line.slice(6);
          try {
            const data = JSON.parse(dataStr) as SSEEvent;
            onEvent(data);
          } catch {
            // ignore unparseable chunks
          }
        }
      }
    }
  }

  // Process any remaining data in the buffer
  if (buffer.startsWith('data: ')) {
    try {
      const data = JSON.parse(buffer.slice(6)) as SSEEvent;
      onEvent(data);
    } catch {
      // ignore
    }
  }
}

export async function fetchFileTree(dirPath: string): Promise<string[]> {
  const response = await fetch(`${API_BASE_URL}/api/files?path=${encodeURIComponent(dirPath)}`);
  if (!response.ok) throw new Error('Fayl siyahısı alına bilmədi');
  const data = await response.json();
  return data.files || [];
}
