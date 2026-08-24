import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { serializeConversationMarkdown, serializeConversationJson, exportConversation } from './exportConversation';
import type { Conversation, Message } from './types';

const conv: Conversation = {
  id: 'c1',
  projectId: 'p1',
  title: 'Test Söhbət',
  messages: [],
  createdAt: 0,
  updatedAt: 0,
};

const messages: Message[] = [
  { id: 'm1', role: 'user', content: 'Salam, necəsən?', timestamp: 1000 },
  { id: 'm2', role: 'assistant', content: 'Salam! Yaxşıyam, sağ ol.', timestamp: 2000 },
  { id: 'm3', role: 'user', content: 'Kod yaz', timestamp: 3000, attachments: [{ id: 'a1', name: 'file.txt', type: 'text/plain', url: '/x' }] },
];

describe('serializeConversationMarkdown', () => {
  it('includes the title and both messages', () => {
    const md = serializeConversationMarkdown(conv, messages);
    expect(md).toContain('# Test Söhbət');
    expect(md).toContain('İstifadəçi');
    expect(md).toContain('BahAI');
    expect(md).toContain('Salam, necəsən?');
    expect(md).toContain('Yaxşıyam, sağ ol.');
  });

  it('mentions attachments', () => {
    const md = serializeConversationMarkdown(conv, messages);
    expect(md).toContain('file.txt');
  });
});

describe('serializeConversationJson', () => {
  it('produces valid JSON with roles and content', () => {
    const json = serializeConversationJson(conv, messages);
    const parsed = JSON.parse(json);
    expect(parsed.title).toBe('Test Söhbət');
    expect(parsed.messages).toHaveLength(3);
    expect(parsed.messages[0].role).toBe('user');
    expect(parsed.messages[1].content).toContain('Yaxşıyam');
  });
});

describe('exportConversation', () => {
  let anchorClick: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    anchorClick = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:mock', revokeObjectURL: () => {} });
    document.body.appendChild = vi.fn();
    document.body.removeChild = vi.fn();
    vi.spyOn(document, 'createElement').mockReturnValue({ click: anchorClick, download: '', href: '', style: {} } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('triggers a markdown download', () => {
    exportConversation(conv, messages, 'markdown');
    expect(anchorClick).toHaveBeenCalled();
  });

  it('triggers a json download', () => {
    exportConversation(conv, messages, 'json');
    expect(anchorClick).toHaveBeenCalled();
  });
});
