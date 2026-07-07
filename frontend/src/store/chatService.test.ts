// ==========================================
// chatService Tests
// ==========================================

import { describe, expect, it, vi } from 'vitest';
import {
  buildConversationTitleFromInput,
  getDefaultConversationTitle,
  getDefaultWorkspaceName,
  getWelcomeMessage,
  normalizeUiErrorMessage,
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
    expect(getDefaultWorkspaceName('web_chat')).toBe('BahAI Cloud Session');
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
