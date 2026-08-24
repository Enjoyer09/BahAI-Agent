// ==========================================
// Conversation Export — Markdown / JSON
// ==========================================
// Serializes a conversation's messages into a human-readable Markdown file
// or a structured JSON blob, then triggers a browser download.

import type { Conversation, Message } from './types';

const ROLE_LABELS: Record<string, string> = {
  user: 'İstifadəçi',
  assistant: 'BahAI',
  tool: 'Tool',
  system: 'Sistem',
};

function formatTimestamp(timestamp?: number): string {
  if (!timestamp) return '';
  try {
    return new Date(timestamp).toLocaleString('az-AZ', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return String(timestamp);
  }
}

function messageToMarkdown(message: Message): string {
  const role = ROLE_LABELS[message.role] || message.role || 'Mesaj';
  const time = formatTimestamp(message.timestamp);
  const header = time ? `### ${role} — ${time}` : `### ${role}`;
  const content = String(message.content || '').trim();
  const body = content ? `\n${content}\n` : '\n_(boş)_\n';

  const attachmentLines = (message.attachments || [])
    .map((att) => `- 📎 ${att.name || 'attachment'}`)
    .join('\n');

  const toolCalls = (message.tool_calls || [])
    .map((tc) => `- 🔧 \`${tc.function?.name || tc.name || 'tool'}\``)
    .join('\n');

  const extras = [attachmentLines, toolCalls].filter(Boolean).join('\n');
  return `${header}\n\n${body}${extras ? `\n${extras}\n` : ''}`;
}

export function serializeConversationMarkdown(conversation: Conversation | null, messages: Message[]): string {
  const title = conversation?.title || 'Adsız söhbət';
  const lines = [
    `# ${title}`,
    '',
    `_BahAI söhbət export — ${new Date().toLocaleString('az-AZ')}_`,
    '',
  ];
  for (const message of messages) {
    lines.push(messageToMarkdown(message));
    lines.push('');
  }
  return lines.join('\n');
}

export function serializeConversationJson(conversation: Conversation | null, messages: Message[]): string {
  return JSON.stringify(
    {
      title: conversation?.title || 'Adsız söhbət',
      exportedAt: new Date().toISOString(),
      messageCount: messages.length,
      messages: messages.map((message) => ({
        role: message.role,
        content: message.content,
        timestamp: message.timestamp,
        attachments: (message.attachments || []).map((att) => ({
          name: att.name,
          type: att.type,
          mimeType: att.mimeType,
          url: att.url,
        })),
        tool_calls: (message.tool_calls || []).map((tc) => ({
          name: tc.function?.name || tc.name,
          arguments: tc.function?.arguments || tc.args,
        })),
      })),
    },
    null,
    2
  );
}

function sanitizeFilename(name: string): string {
  return String(name || 'söhbət')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '_')
    .slice(0, 80);
}

function triggerDownload(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export function exportConversation(conversation: Conversation | null, messages: Message[], format: 'markdown' | 'json' = 'markdown'): void {
  if (format === 'json') {
    const content = serializeConversationJson(conversation, messages);
    triggerDownload(content, `${sanitizeFilename(conversation?.title || 'söhbət')}.json`, 'application/json');
    return;
  }
  const content = serializeConversationMarkdown(conversation, messages);
  triggerDownload(content, `${sanitizeFilename(conversation?.title || 'söhbət')}.md`, 'text/markdown');
}