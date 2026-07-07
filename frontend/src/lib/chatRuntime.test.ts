import { describe, expect, it } from 'vitest';
import {
  chooseAssistantContent,
  mergeGuiObservationIntoMemory,
  mergeHumanCheckpointIntoMemory,
  resolveActiveGuiSessionInMemory
} from './chatRuntime';

describe('active GUI session memory', () => {
  it('stores checkpoint session as pending login', () => {
    const memory = mergeHumanCheckpointIntoMemory({}, {
      id: 'cp1',
      kind: 'login',
      workflow: 'gui',
      sessionId: 'gui-wix-live',
      conversationId: 'conv1',
      runId: 'run1',
      phaseRole: 'Planner',
      title: 'Wix login checkpoint',
      message: 'login et',
      resumePrompt: 'login oldum'
    });
    expect((memory as any).activeGuiSession.sessionId).toBe('gui-wix-live');
    expect((memory as any).activeGuiSession.status).toBe('pending_login');
  });

  it('marks gui session ready after gui observation artifact', () => {
    const memory = mergeGuiObservationIntoMemory({
      activeGuiSession: {
        sessionId: 'gui-wix-live',
        status: 'pending_login',
        updatedAt: Date.now()
      }
    }, {
      kind: 'gui',
      summary: 'Action: observe',
      url: 'https://manage.wix.com/dashboard',
      status: 'info',
      timestamp: Date.now()
    });
    expect((memory as any).activeGuiSession.status).toBe('ready');
    expect((memory as any).activeGuiSession.url).toContain('wix.com');
  });

  it('closes active gui session on cancel', () => {
    const memory = resolveActiveGuiSessionInMemory({
      activeGuiSession: {
        sessionId: 'gui-wix-live',
        status: 'pending_login',
        updatedAt: Date.now()
      }
    }, 'cancel');
    expect((memory as any).activeGuiSession.status).toBe('closed');
  });

  it('keeps the longer streamed answer when final content looks truncated', () => {
    const streamed = 'Bəli, Azərbaycan Respublikasının Vergi Məcəlləsi haqqında ümumi məlumata sahibəm. Vergi Məcəlləsi 2000-ci ildə qəbul edilib və iki əsas hissədən ibarətdir: Ümumi hissə və Xüsusi hissə. Əsas vergi növləri bunlardır.';
    const final = 'Bəli, Azərbaycan Respublikasının Vergi Məcəlləsi haqqında ümumi məlumata sahibəm. Əsas vergi növləri:';
    expect(chooseAssistantContent(streamed, final)).toBe(streamed);
  });

  it('keeps the streamed answer when final text is report-shaped and shorter', () => {
    const streamed = 'Laptopmarket.az üzrə ilk nəticələrə görə ən ucuz laptop qiymətini dəqiqləşdirmək üçün public nəticələr topladım və aşağıdakı variantlar görünür.';
    const final = '**Problem**\n- Laptopmarket.az üzrə ilk nəticələr';
    expect(chooseAssistantContent(streamed, final)).toBe(streamed);
  });

  it('prefers the final answer when it is complete and longer', () => {
    const streamed = 'Bakıda hava';
    const final = 'Bu gün Bakı üçün ən dəqiq nəticəni web axtarışdan yoxlayıb sizə temperatur intervalını deyə bilərəm.';
    expect(chooseAssistantContent(streamed, final)).toBe(final);
  });
});
