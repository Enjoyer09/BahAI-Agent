import { describe, it, expect } from 'vitest';

const {
  isGuiObserveSelfTestRequest,
  isGuiLoginCheckpointRequest,
  isGuiLoginResumeRequest,
  isGuiOpenAndAwaitRequest,
  isGuiContinuationRequest,
  extractUrlFromGuiRequest,
  buildGuiBrowserOpenArgs,
  shouldAdvertiseScreenAgent
} = require('../gui/requests');
const { resolveGuiBrowserPolicy, getRecommendedGuiBrowserMode, shouldPreferCdp } = require('../gui/browserPolicy');
const { buildGuiCapabilityStatus } = require('../gui/capabilityStatus');

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

  it('detects generic gui open-and-await requests', () => {
    expect(
      isGuiOpenAndAwaitRequest('GUI agent chrome da laptopmarket.az saytini ac. Workflow: gui.')
    ).toBe(true);
    expect(extractUrlFromGuiRequest('GUI agent chrome da laptopmarket.az saytini ac. Workflow: gui.')).toBe('https://laptopmarket.az');
  });

  it('detects generic gui continuation requests without url', () => {
    expect(
      isGuiContinuationRequest('ASUS gaming laptop axtar. Workflow: gui.')
    ).toBe(true);
  });

  it('detects price-oriented shopping follow-up requests as gui continuation', () => {
    expect(
      isGuiContinuationRequest('ən ucuz dell laptopunu tap', { hasActiveSession: true })
    ).toBe(true);
    expect(
      isGuiContinuationRequest('en ucuz dell laptopunu axtar tap', { hasActiveSession: true })
    ).toBe(true);
  });

  it('does not route generic show requests without an active gui session', () => {
    expect(
      isGuiContinuationRequest('Developer mesajlarını olduğu kimi göstər')
    ).toBe(false);
    expect(
      isGuiContinuationRequest('Yalnız yekun rəqəmi göstər: 9+8')
    ).toBe(false);
  });

  it('does not treat fresh URL opens as continuation', () => {
    expect(
      isGuiContinuationRequest('GUI agent chrome da laptopmarket.az saytını aç')
    ).toBe(false);
  });

  it('does not treat normal descriptive chat text as gui continuation', () => {
    expect(
      isGuiContinuationRequest('hp warranty check sehifesinde warranty expired gosterir amma distributer malin qarantiyada oldugunu deyir. ne meseleydi?')
    ).toBe(false);
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

  it('forces persistent real-chrome args when requested for gui open flows', () => {
    const args = buildGuiBrowserOpenArgs({
      url: 'https://laptopmarket.az',
      sessionId: 'gui-live',
      guiBrowserMode: 'cdp',
      defaultCdpUrl: 'http://127.0.0.1:9222',
      fallbackChromePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      preferPersistentIfChrome: true
    });

    expect(args.persistent).toBe(true);
    expect(args.browserChannel).toBe('chrome');
    expect(args.cdpUrl).toBeUndefined();
  });

  it('forces persistent chrome args even when path is not pre-resolved', () => {
    const args = buildGuiBrowserOpenArgs({
      url: 'https://laptopmarket.az',
      sessionId: 'gui-live',
      guiBrowserMode: 'cdp',
      defaultCdpUrl: 'http://127.0.0.1:9222',
      preferPersistentIfChrome: true
    });

    expect(args.persistent).toBe(true);
    expect(args.browserChannel).toBe('chrome');
    expect(args.executablePath).toBeUndefined();
    expect(args.cdpUrl).toBeUndefined();
  });
});

describe('browser policy', () => {
  it('recommends persistent when chrome exists even if cdp url exists', () => {
    expect(
      getRecommendedGuiBrowserMode({
        installedBrowsers: [{ id: 'chrome', installed: true, recommended: true, supportsCdp: true, path: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' }],
        cdpUrl: 'http://127.0.0.1:9222'
      })
    ).toBe('persistent');
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

describe('GUI capability status', () => {
  it('marks screen agent unavailable on non-macos platforms', () => {
    const status = buildGuiCapabilityStatus({
      runtimePlatform: 'linux',
      guiBrowserMode: 'bundled',
      defaultCdpUrl: ''
    });

    expect(status.screenAgent.available).toBe(false);
    expect(status.screenAgent.reasons).toContain('screen_agent_macos_only');
    expect(status.computerUse.available).toBe(false);
    expect(status.computerUse.reasons).toContain('computer_use_macos_only');
  });

  it('does not advertise screen agent when unavailable', () => {
    expect(
      shouldAdvertiseScreenAgent({
        latestUserText: 'Real browser ile desktop automation et',
        workflow: 'gui',
        guiCapabilities: {
          screenAgent: { available: false }
        }
      })
    ).toBe(false);
  });
});
