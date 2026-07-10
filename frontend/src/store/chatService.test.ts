// ==========================================
// chatService Tests
// ==========================================

import { describe, expect, it, vi } from 'vitest';
vi.mock('../lib/telemetry', () => ({
  trackToolUse: vi.fn(),
  trackChatError: vi.fn(),
}));

import {
  buildConversationTitleFromInput,
  getDefaultConversationTitle,
  getDefaultWorkspaceName,
  getWelcomeMessage,
  isWelcomeLikeAssistantMessage,
  sanitizeWebChatHistory,
  buildWebReferentSummary,
  normalizeUiErrorMessage,
  handleSSEEvent,
} from './chatService';

// ==========================================
// Helper Function Tests
// ==========================================

describe('getDefaultConversationTitle', () => {
  it('returns desktop default when no product mode', () => {
    expect(getDefaultConversationTitle()).toBe('Yeni söhbət');
  });

  it('returns web chat default for web_chat mode', () => {
    expect(getDefaultConversationTitle('web_chat')).toBe('Yeni chat');
  });

  it('returns desktop default for desktop_code mode', () => {
    expect(getDefaultConversationTitle('desktop_code')).toBe('Yeni söhbət');
  });
});

describe('getDefaultWorkspaceName', () => {
  it('returns sandbox for desktop mode', () => {
    expect(getDefaultWorkspaceName()).toBe('bahAI Sandbox');
  });

  it('returns cloud session for web_chat mode', () => {
    expect(getDefaultWorkspaceName('web_chat')).toBe('BahAI Session');
  });
});

describe('getWelcomeMessage', () => {
  it('returns server-backed message for desktop', () => {
    const msg = getWelcomeMessage('desktop_code', true);
    expect(msg).toContain('bahAI agentiyəm');
    expect(msg).toContain('workspace');
  });

  it('returns offline message for desktop', () => {
    const msg = getWelcomeMessage('desktop_code', false);
    expect(msg).toContain('bahAI agentiyəm');
    expect(msg).toContain('Sandbox');
  });

  it('returns server-backed message for web_chat', () => {
    const msg = getWelcomeMessage('web_chat', true);
    expect(msg).toContain('Söhbət tarixçəniz');
    expect(msg).toContain('tarixçəniz');
  });

  it('returns offline message for web_chat', () => {
    const msg = getWelcomeMessage('web_chat', false);
    expect(msg).toContain('Yazın');
    expect(msg).toContain('kömək');
  });
});

describe('isWelcomeLikeAssistantMessage', () => {
  it('detects web intro text', () => {
    expect(isWelcomeLikeAssistantMessage('Salam! Yazın, mən kömək edim.', 'web_chat')).toBe(true);
  });

  it('detects generic bahai intro text in web mode', () => {
    expect(isWelcomeLikeAssistantMessage('Salam! Mən BahAI asistentiəm. Hazırsınızsa sualınızı yazın.', 'web_chat')).toBe(true);
  });

  it('does not flag regular assistant replies', () => {
    expect(isWelcomeLikeAssistantMessage('Bakıda bu gün hava təxminən 30°C-dir.', 'web_chat')).toBe(false);
  });
});

describe('sanitizeWebChatHistory', () => {
  it('removes browser/session/error noise from web history', () => {
    const result = sanitizeWebChatHistory([
      { id: '1', role: 'assistant', content: 'Eyni browser sessiyasında davam edirəm.', timestamp: 1 },
      { id: '2', role: 'assistant', content: '❌ Xəta: Cavab tamamlanmadan əlaqə kəsildi.', timestamp: 2 },
      { id: '3', role: 'assistant', content: 'HP warranty ilə distributor zəmanəti fərqli ola bilər.', timestamp: 3 },
      { id: '4', role: 'user', content: '120 ədəd notebook alınıb', timestamp: 4 },
    ] as any);

    expect(result).toHaveLength(2);
    expect(result[0].content).toContain('HP warranty');
    expect(result[1].content).toContain('120 ədəd notebook');
  });
});

describe('buildWebReferentSummary', () => {
  it('builds referent summary for deqiqleshdir follow-up', () => {
    const result = buildWebReferentSummary([
      { id: '1', role: 'user', content: 'HP 250 G10', timestamp: 1 },
      { id: '2', role: 'assistant', content: 'Tam spesifikasiya və ya qiymət maraqlıdırsa, dəqiqləşdirim.', timestamp: 2 },
    ] as any, 'deqiqleshdir');

    expect(result).toBeTruthy();
    expect((result as any).previousUser).toBe('HP 250 G10');
    expect((result as any).previousAssistant).toContain('dəqiqləşdirim');
  });

  it('includes previous attachment for visual referential follow-up', () => {
    const result = buildWebReferentSummary([
      { id: '1', role: 'user', content: 'bu sekil ne senedidir?', attachments: [{ id: 'a1', name: 'doc.jpg', type: 'image', mimeType: 'image/jpeg', extractedText: 'DISTRIBUTERIN ETIBARNAMESININ FORMASI' }], timestamp: 1 },
      { id: '2', role: 'assistant', content: 'Bu şəkil distributer etibarnaməsidir.', timestamp: 2 },
    ] as any, 'bu sened');

    expect(result).toBeTruthy();
    expect((result as any).previousAttachment.name).toBe('doc.jpg');
    expect((result as any).previousAttachment.extractedText).toContain('DISTRIBUTERIN');
  });
});

describe('buildConversationTitleFromInput', () => {
  it('uses default title for empty input', () => {
    expect(buildConversationTitleFromInput('')).toBe('Yeni söhbət');
  });

  it('uses default title for whitespace-only input', () => {
    expect(buildConversationTitleFromInput('   ')).toBe('Yeni söhbət');
  });

  it('trims long input to 48 chars', () => {
    const long = 'a'.repeat(100);
    const title = buildConversationTitleFromInput(long);
    expect(title.length).toBeLessThanOrEqual(51); // 48 + '...'
    expect(title.endsWith('...')).toBe(true);
  });

  it('keeps short input as-is', () => {
    expect(buildConversationTitleFromInput('Salam')).toBe('Salam');
  });

  it('strips polite prefixes', () => {
    expect(buildConversationTitleFromInput('zəhmət olmasa bunu et')).toBe('bunu et');
    expect(buildConversationTitleFromInput('please help')).toBe('help');
  });

  it('strips quotes', () => {
    expect(buildConversationTitleFromInput('"Salam"')).toBe('Salam');
  });

  it('uses web_chat default when mode is web_chat', () => {
    expect(buildConversationTitleFromInput('', 'web_chat')).toBe('Yeni chat');
  });
});

// ==========================================
// normalizeUiErrorMessage Tests
// ==========================================

describe('normalizeUiErrorMessage', () => {
  it('returns default for empty input', () => {
    expect(normalizeUiErrorMessage('')).toBe('Naməlum xəta baş verdi.');
  });

  it('strips API xətası prefix', () => {
    expect(normalizeUiErrorMessage('API xətası: Server error')).toBe('Server error');
  });

  it('strips Tool xətası prefix', () => {
    expect(normalizeUiErrorMessage('Tool xətası: Failed')).toBe('Failed');
  });

  it('strips Error executing tool prefix', () => {
    expect(normalizeUiErrorMessage('Error executing tool: Timeout')).toBe('Timeout');
  });

  it('keeps regular text as-is', () => {
    expect(normalizeUiErrorMessage('Something went wrong')).toBe('Something went wrong');
  });
});

describe('handleSSEEvent', () => {
  it('suppresses noisy partial-stream disconnect error in web chat when text is already visible', () => {
    const sink = {
      setTaskPlan: vi.fn(),
      addSystemMessage: vi.fn(),
      updateAssistantMessage: vi.fn(),
      finalizeAssistantMessage: vi.fn(),
      updateToolExecution: vi.fn(),
      addToolResult: vi.fn(),
      addApproval: vi.fn(),
      removeApproval: vi.fn(),
      setHumanCheckpoint: vi.fn(),
      setPlannerArtifact: vi.fn(),
      setExecutionArtifacts: vi.fn(),
      mergeProjectMemory: vi.fn(),
      updateProjectPort: vi.fn(),
      incrementPreviewKey: vi.fn(),
    };

    handleSSEEvent({ type: 'error', message: 'Cavabın görünən hissəsi saxlanıldı. Qalan hissə yarımçıq kəsildi; davamı üçün yenidən göndərin.' } as any, {
      convId: 'c1',
      projectMemory: {},
      activeProject: null,
      serverBacked: false,
      settings: { productMode: 'web_chat', model: 'gpt-4o', workflow: 'quick' } as any,
      sink: sink as any,
      currentMsgs: { current: [] },
      streamBufferRef: { current: 'Bakıda bu gün hava təxminən 30°C-dir.' },
    });

    expect(sink.addSystemMessage).not.toHaveBeenCalled();
  });
});
