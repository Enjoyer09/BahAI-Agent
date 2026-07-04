import { describe, expect, it } from 'vitest';
import { mergeGuiObservationIntoMemory, mergeHumanCheckpointIntoMemory, resolveActiveGuiSessionInMemory } from './chatRuntime';

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
});
