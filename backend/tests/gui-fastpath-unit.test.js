import { describe, it, expect, vi } from 'vitest';

const { handleGuiLoginCheckpoint, handleGuiLoginCheckpointAction } = require('../gui/fastpath');

function createFakeRes() {
  const chunks = [];
  return {
    chunks,
    setHeader() {},
    flushHeaders() {},
    write(value) {
      chunks.push(String(value));
    },
    end() {
      chunks.push('[END]');
    }
  };
}

describe('GUI fastpath unit', () => {
  it('emits human checkpoint when browser_open succeeded with warning text', async () => {
    const res = createFakeRes();
    const handleToolCall = vi.fn(async () => (
      'Browser opened: https://www.wix.com\nVisible: true\nWarning: Requested browser unavailable, fell back to bundled Chromium: demo'
    ));

    await handleGuiLoginCheckpoint({
      res,
      orchestration: { workflow: 'gui', mode: 'orchestrated', agents: ['Planner'], routing: {}, enabled: false },
      runManager: { snapshot: () => ({ currentRole: 'Planner', phases: [] }) },
      resolvedWD: '/tmp',
      reqUser: { id: 'u1' },
      handleToolCall,
      normalizeUserFacingError: (value) => value,
      browserOpenArgs: { url: 'https://www.wix.com', sessionId: 'gui-wix-live', visible: true },
      createCheckpoint: () => ({})
    });

    const text = res.chunks.join('\n');
    expect(text.includes('"type":"human_checkpoint"')).toBe(true);
    expect(text.includes('Browser açıla bilmədi')).toBe(false);
  });

  it('resume action preserves checkpoint session id for gui_observe', async () => {
    const res = createFakeRes();
    const handleToolCall = vi.fn(async () => '{"observation":{"title":"Home | Wix.com"}}');

    await handleGuiLoginCheckpointAction({
      res,
      checkpoint: {
        kind: 'login',
        workflow: 'gui',
        decision: 'resume',
        sessionId: 'gui-wix-live-custom'
      },
      orchestration: { workflow: 'gui', mode: 'manager_direct', agents: ['Solo Agent'], routing: {}, enabled: false },
      runManager: { snapshot: () => ({ currentRole: 'Solo Agent', phases: [] }) },
      resolvedWD: '/tmp',
      reqUser: { id: 'u1' },
      handleToolCall,
      normalizeUserFacingError: (value) => value
    });

    expect(handleToolCall).toHaveBeenCalledTimes(1);
    const toolCall = handleToolCall.mock.calls[0][0];
    const parsed = JSON.parse(toolCall.function.arguments);
    expect(parsed.sessionId).toBe('gui-wix-live-custom');
  });

  it('surfaces capability-aware browser guidance when launch fails', async () => {
    const res = createFakeRes();
    const handleToolCall = vi.fn(async () => (
      'Browser open error: No installed Chrome found for CDP mode\nCode: chrome_missing\nCDP: http://127.0.0.1:9222'
    ));

    await handleGuiLoginCheckpoint({
      res,
      orchestration: { workflow: 'gui', mode: 'orchestrated', agents: ['Planner'], routing: {}, enabled: false },
      runManager: { snapshot: () => ({ currentRole: 'Planner', phases: [] }) },
      resolvedWD: '/tmp',
      reqUser: { id: 'u1' },
      handleToolCall,
      normalizeUserFacingError: (value) => String(value).includes('chrome_missing')
        ? 'Browser açıla bilmədi: bu mühitdə GUI üçün lazım olan Chrome tapılmadı.\n\nDüzəltmə addımı:\n1. Lokal Mac-də Google Chrome quraşdırın və ya BahAI Settings-də browser mode-u `bundled` edin.\n2. Real Chrome ilə davam etmək istəyirsinizsə `scripts/start-debug-chrome.sh` işlədin.\n3. Sonra Settings-də `cdp` və ya `persistent` mode seçin.'
        : value,
      browserOpenArgs: { url: 'https://www.wix.com', sessionId: 'gui-wix-live', visible: true },
      createCheckpoint: () => ({})
    });

    const text = res.chunks.join('\n');
    expect(text.includes('Chrome tapılmadı')).toBe(true);
    expect(text.includes('start-debug-chrome.sh')).toBe(true);
    expect(text.includes('"type":"human_checkpoint"')).toBe(false);
  });
});
