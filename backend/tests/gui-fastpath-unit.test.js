import { describe, it, expect, vi } from 'vitest';

const { handleGuiLoginCheckpoint, handleGuiLoginCheckpointAction, handleGuiOpenAndAwaitInstruction, handleGuiContinuation } = require('../gui/fastpath');

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

  it('opens generic gui site and then asks user for the next step', async () => {
    const res = createFakeRes();
    const handleToolCall = vi
      .fn()
      .mockResolvedValueOnce('Browser opened: https://laptopmarket.az\nTitle: Laptop Market\nSession: gui-live\nVisible: true')
      .mockResolvedValueOnce('{"observation":{"sessionId":"gui-live","title":"Laptop Market","url":"https://laptopmarket.az"}}');

    await handleGuiOpenAndAwaitInstruction({
      res,
      orchestration: { workflow: 'gui', mode: 'manager_direct', agents: ['Solo Agent'], routing: {}, enabled: false },
      runManager: { snapshot: () => ({ currentRole: 'Solo Agent', phases: [] }) },
      resolvedWD: '/tmp',
      reqUser: { id: 'u1' },
      handleToolCall,
      normalizeUserFacingError: (value) => value,
      promptText: 'GUI agent chrome da laptopmarket.az saytini ac. Workflow: gui.',
      browserOpenArgs: { url: 'https://laptopmarket.az', sessionId: 'gui-live', visible: true }
    });

    const text = res.chunks.join('\n');
    expect(text.includes('Saytı visible browser-də açır')).toBe(true);
    expect(text.includes('Sayt açıldı və sessiya aktivdir')).toBe(true);
    expect(text.includes('başqa nə etməyimi istəyirsiniz')).toBe(true);
  });

  it('continues on the same gui session for follow-up instruction', async () => {
    const res = createFakeRes();
    const handleToolCall = vi
      .fn()
      .mockResolvedValueOnce('Pressed Meta+L')
      .mockResolvedValueOnce('Typed into: body')
      .mockResolvedValueOnce('Pressed Enter')
      .mockResolvedValueOnce('{"observation":{"sessionId":"gui-live","title":"Search Results","url":"https://laptopmarket.az/search"}}');

    await handleGuiContinuation({
      res,
      orchestration: { workflow: 'gui', mode: 'manager_direct', agents: ['Solo Agent'], routing: {}, enabled: false },
      runManager: { snapshot: () => ({ currentRole: 'Solo Agent', phases: [] }) },
      resolvedWD: '/tmp',
      reqUser: { id: 'u1' },
      handleToolCall,
      normalizeUserFacingError: (value) => value,
      sessionId: 'gui-live',
      promptText: 'ASUS gaming laptop axtar'
    });

    expect(handleToolCall).toHaveBeenCalledTimes(4);
    const firstArgs = JSON.parse(handleToolCall.mock.calls[0][0].function.arguments);
    const fourthArgs = JSON.parse(handleToolCall.mock.calls[3][0].function.arguments);
    expect(firstArgs.sessionId).toBe('gui-live');
    expect(fourthArgs.sessionId).toBe('gui-live');
    expect(res.chunks.join('\n').includes('eyni browser sessiyası açıq qalır')).toBe(true);
  });

  it('preserves the same gui session for shopping-style follow-up prompts', async () => {
    const res = createFakeRes();
    const handleToolCall = vi
      .fn()
      .mockResolvedValueOnce('Pressed Meta+L')
      .mockResolvedValueOnce('Typed into: body')
      .mockResolvedValueOnce('Pressed Enter')
      .mockResolvedValueOnce('{"observation":{"sessionId":"gui-live","title":"Dell results","url":"https://laptopmarket.az/search?q=dell"}}');

    await handleGuiContinuation({
      res,
      orchestration: { workflow: 'gui', mode: 'manager_direct', agents: ['Solo Agent'], routing: {}, enabled: false },
      runManager: { snapshot: () => ({ currentRole: 'Solo Agent', phases: [] }) },
      resolvedWD: '/tmp',
      reqUser: { id: 'u1' },
      handleToolCall,
      normalizeUserFacingError: (value) => value,
      sessionId: 'gui-live',
      promptText: 'en ucuz dell laptopunu axtar tap'
    });

    expect(handleToolCall).toHaveBeenCalledTimes(4);
    for (const call of handleToolCall.mock.calls) {
      const parsed = JSON.parse(call[0].function.arguments);
      expect(parsed.sessionId).toBe('gui-live');
    }
    expect(res.chunks.join('\n')).toContain('Aktiv browser sessiyasında davam edirəm');
  });

  it('retries generic open flow with persistent browser when cdp is unreachable', async () => {
    const res = createFakeRes();
    const handleToolCall = vi
      .fn()
      .mockResolvedValueOnce('Browser open error: Chrome CDP did not become reachable at http://127.0.0.1:9222\nCode: cdp_unreachable')
      .mockResolvedValueOnce('Browser opened: https://laptopmarket.az\nTitle: Laptop Market\nSession: gui-live\nOpened via: persistent')
      .mockResolvedValueOnce('{"observation":{"sessionId":"gui-live","title":"Laptop Market","url":"https://laptopmarket.az"}}');

    await handleGuiOpenAndAwaitInstruction({
      res,
      orchestration: { workflow: 'gui', mode: 'manager_direct', agents: ['Solo Agent'], routing: {}, enabled: false },
      runManager: { snapshot: () => ({ currentRole: 'Solo Agent', phases: [] }) },
      resolvedWD: '/tmp',
      reqUser: { id: 'u1' },
      handleToolCall,
      normalizeUserFacingError: (value) => value,
      promptText: 'GUI agent chrome da laptopmarket.az saytini ac. Workflow: gui.',
      browserOpenArgs: { url: 'https://laptopmarket.az', sessionId: 'gui-live', visible: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', cdpUrl: 'http://127.0.0.1:9222' }
    });

    expect(handleToolCall).toHaveBeenCalledTimes(3);
    const retryArgs = JSON.parse(handleToolCall.mock.calls[1][0].function.arguments);
    expect(retryArgs.persistent).toBe(true);
    expect(retryArgs.browserChannel).toBe('chrome');
    expect(res.chunks.join('\n').includes('Sayt açıldı və sessiya aktivdir')).toBe(true);
  });

  it('uses persistent real-chrome launch for wix login checkpoint flow', async () => {
    const res = createFakeRes();
    const handleToolCall = vi.fn(async () => 'Browser opened: https://www.wix.com\nTitle: Home | Wix.com\nSession: gui-wix-live\nOpened via: persistent');

    await handleGuiLoginCheckpoint({
      res,
      orchestration: { workflow: 'gui', mode: 'manager_direct', agents: ['Solo Agent'], routing: {}, enabled: false },
      runManager: { snapshot: () => ({ currentRole: 'Solo Agent', phases: [] }), currentPhase: () => ({ role: 'Solo Agent' }) },
      resolvedWD: '/tmp',
      conversationId: 'c1',
      reqUser: { id: 'u1' },
      handleToolCall,
      normalizeUserFacingError: (value) => value,
      browserOpenArgs: {
        url: 'https://www.wix.com',
        sessionId: 'gui-wix-live',
        visible: true,
        persistent: true,
        browserChannel: 'chrome',
        executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      },
      createCheckpoint: () => ({})
    });

    const firstCall = handleToolCall.mock.calls[0][0];
    const parsed = JSON.parse(firstCall.function.arguments);
    expect(parsed.persistent).toBe(true);
    expect(parsed.browserChannel).toBe('chrome');
    expect(parsed.cdpUrl).toBeUndefined();
  });

  it('stops after browser launch failure and does not run gui_observe', async () => {
    const res = createFakeRes();
    const handleToolCall = vi
      .fn()
      .mockResolvedValueOnce('Browser open error: No installed Chrome found for CDP mode\nCode: chrome_missing');

    await handleGuiOpenAndAwaitInstruction({
      res,
      orchestration: { workflow: 'gui', mode: 'manager_direct', agents: ['Solo Agent'], routing: {}, enabled: false },
      runManager: { snapshot: () => ({ currentRole: 'Solo Agent', phases: [] }) },
      resolvedWD: '/tmp',
      reqUser: { id: 'u1' },
      handleToolCall,
      normalizeUserFacingError: (value) => value,
      promptText: 'GUI agent chrome da laptopmarket.az saytini ac. Workflow: gui.',
      browserOpenArgs: { url: 'https://laptopmarket.az', sessionId: 'gui-live', visible: true, cdpUrl: 'http://127.0.0.1:9222' }
    });

    expect(handleToolCall).toHaveBeenCalledTimes(1);
    const text = res.chunks.join('\n');
    expect(text).toContain('Saytı aça bilmədim');
    expect(text).not.toContain('Sayt açıldı və sessiya aktivdir');
  });
});
