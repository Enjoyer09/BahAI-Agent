import { describe, it, expect } from 'vitest';

const {
  isGuiObserveSelfTestRequest,
  isGuiLoginCheckpointRequest,
  isGuiLoginResumeRequest,
  buildGuiBrowserOpenArgs
} = require('../gui/requests');
const { resolveGuiBrowserPolicy, getRecommendedGuiBrowserMode, shouldPreferCdp } = require('../gui/browserPolicy');

describe('GUI request classifiers', () => {
  it('detects wix login checkpoint requests', () => {
    expect(
      isGuiLoginCheckpointRequest('GUI Agent ilə visible browser aç və wix.com daxil ol. Mən login olana qədər gözlə. Workflow: gui.')
    ).toBe(true);
  });

  it('detects wix login resume requests', () => {
    expect(
      isGuiLoginResumeRequest('login oldum. İndi observe et və Wix dashboard-da SEO settings-ə getmək üçün növbəti təhlükəsiz addımı de. Workflow: gui.')
    ).toBe(true);
  });

  it('detects example.com self test requests', () => {
    expect(
      isGuiObserveSelfTestRequest('Browser-də https://example.com aç. Screenshot götür. Heç bir riskli action etmə. Workflow: gui.')
    ).toBe(true);
  });
});

describe('buildGuiBrowserOpenArgs', () => {
  it('builds cdp mode args with default cdp url', () => {
    const args = buildGuiBrowserOpenArgs({
      url: 'https://www.wix.com',
      sessionId: 'gui-wix-live',
      guiBrowserMode: 'cdp',
      defaultCdpUrl: 'http://127.0.0.1:9222'
    });

    expect(args.cdpUrl).toBe('http://127.0.0.1:9222');
    expect(args.visible).toBe(true);
  });

  it('builds persistent mode args with fallback chrome path', () => {
    const args = buildGuiBrowserOpenArgs({
      url: 'https://www.wix.com',
      sessionId: 'gui-wix-live',
      guiBrowserMode: 'persistent',
      fallbackChromePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    });

    expect(args.browserChannel).toBe('chrome');
    expect(args.persistent).toBe(true);
    expect(args.executablePath).toContain('Google Chrome');
  });

  it('falls back to bundled mode when persistent is requested without Chrome path', () => {
    const args = buildGuiBrowserOpenArgs({
      url: 'https://www.wix.com',
      sessionId: 'gui-wix-live',
      guiBrowserMode: 'persistent'
    });

    expect(args.persistent).toBeUndefined();
    expect(args.cdpUrl).toBeUndefined();
    expect(args.visible).toBe(true);
  });
});

describe('browser policy', () => {
  it('recommends cdp when cdp url exists', () => {
    expect(
      getRecommendedGuiBrowserMode({
        installedBrowsers: [{ id: 'chrome', installed: true, recommended: true, supportsCdp: true, path: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' }],
        cdpUrl: 'http://127.0.0.1:9222'
      })
    ).toBe('cdp');
  });

  it('recommends persistent when chrome exists but no cdp url exists', () => {
    expect(
      getRecommendedGuiBrowserMode({
        installedBrowsers: [{ id: 'chrome', installed: true, recommended: true, path: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' }],
        cdpUrl: ''
      })
    ).toBe('persistent');
  });

  it('resolves persistent request to bundled when no browser path is available', () => {
    const policy = resolveGuiBrowserPolicy({
      guiBrowserMode: 'persistent',
      guiBrowserPath: '',
      fallbackChromePath: '',
      installedBrowsers: []
    });

    expect(policy.mode).toBe('bundled');
  });

  it('does not prefer cdp on linux without an installed chrome target', () => {
    expect(
      shouldPreferCdp({
        installedBrowsers: [],
        cdpUrl: 'http://127.0.0.1:9222',
        runtimePlatform: 'linux'
      })
    ).toBe(false);
  });

  it('falls back to bundled on linux when cdp is configured but chrome is unavailable', () => {
    const policy = resolveGuiBrowserPolicy({
      guiBrowserMode: 'cdp',
      guiBrowserCdpUrl: 'http://127.0.0.1:9222',
      installedBrowsers: [],
      runtimePlatform: 'linux'
    });

    expect(policy.mode).toBe('bundled');
  });
});
