import { describe, it, expect } from 'vitest';

const { isCdpContextManagementError } = require('../browserSession');
const { createBrowserLaunchError } = require('../browserSession');
const { getSession, closeAllSessions, buildDefaultBahaiChromeProfileDir } = require('../browserSession');
const path = require('path');
const net = require('net');

describe('browserSession env precedence', () => {
  it('does not let env cdp override explicit persistent chrome launch intent', async () => {
    process.env.GUI_BROWSER_CDP_URL = 'http://127.0.0.1:9222';
    process.env.GUI_BROWSER_PERSISTENT = 'false';

    const playwright = await import('playwright');
    const originalLaunchPersistentContext = playwright.chromium.launchPersistentContext;
    const originalConnectOverCDP = playwright.chromium.connectOverCDP;

    const fakeContext = {
      browser: () => ({ close: async () => {} }),
      pages: () => [],
      newPage: async () => ({ goto: async () => {}, title: async () => '' }),
      close: async () => {}
    };

    playwright.chromium.launchPersistentContext = async () => fakeContext;
    playwright.chromium.connectOverCDP = async () => {
      throw new Error('connectOverCDP should not be called');
    };

    try {
      const session = await getSession('test-persistent-env-precedence', {
        persistent: true,
        browserChannel: 'chrome',
        userDataDir: path.join('/tmp', 'bahai-test-profile'),
        visible: true
      });
      expect(session.openedVia).toBe('persistent');
      expect(session.cdpAttached).toBe(false);
    } finally {
      playwright.chromium.launchPersistentContext = originalLaunchPersistentContext;
      playwright.chromium.connectOverCDP = originalConnectOverCDP;
      await closeAllSessions();
      delete process.env.GUI_BROWSER_CDP_URL;
      delete process.env.GUI_BROWSER_PERSISTENT;
    }
  });

  it('reuses the same session when explicit launch options produce the same signature', async () => {
    delete process.env.GUI_BROWSER_CDP_URL;
    const playwright = await import('playwright');
    const originalLaunchPersistentContext = playwright.chromium.launchPersistentContext;

    let launchCount = 0;
    const fakeContext = {
      browser: () => ({ close: async () => {} }),
      pages: () => [],
      newPage: async () => ({ goto: async () => {}, title: async () => '' }),
      close: async () => {}
    };

    playwright.chromium.launchPersistentContext = async () => {
      launchCount += 1;
      return fakeContext;
    };

    try {
      const first = await getSession('test-same-signature', {
        persistent: true,
        browserChannel: 'chrome',
        userDataDir: path.join('/tmp', 'bahai-test-same-signature'),
        visible: true
      });
      const second = await getSession('test-same-signature', {
        persistent: true,
        browserChannel: 'chrome',
        userDataDir: path.join('/tmp', 'bahai-test-same-signature'),
        visible: true
      });
      expect(first).toBe(second);
      expect(launchCount).toBe(1);
    } finally {
      playwright.chromium.launchPersistentContext = originalLaunchPersistentContext;
      await closeAllSessions();
    }
  });
});

describe('browserSession no-auto-launch guard', () => {
  it('fails fast with cdp_unreachable instead of spawning Chrome when GUI_BROWSER_NO_AUTO_LAUNCH is set', async () => {
    process.env.GUI_BROWSER_NO_AUTO_LAUNCH = 'true';
    delete process.env.GUI_BROWSER_CDP_URL;
    const originalCreateConnection = net.createConnection;

    // Make isCdpReachable() fail fast (CDP unreachable) without touching the
    // network: emit an error on the next tick, before the 800ms timeout.
    net.createConnection = () => {
      const handlers = {};
      const socket = {
        setTimeout() {},
        on(event, handler) {
          handlers[event] = handler;
          return this;
        },
        destroy() {}
      };
      process.nextTick(() => {
        if (handlers.error) handlers.error(new Error('ECONNREFUSED'));
      });
      return socket;
    };

    try {
      const error = await getSession('test-no-auto-launch', {
        cdpUrl: 'http://127.0.0.1:9',
        visible: true
      }).then(
        () => { throw new Error('expected getSession to throw'); },
        (err) => err
      );
      expect(error.browserLaunchCode).toBe('cdp_unreachable');
      expect(error.message).toContain('GUI_BROWSER_NO_AUTO_LAUNCH');
    } finally {
      net.createConnection = originalCreateConnection;
      delete process.env.GUI_BROWSER_NO_AUTO_LAUNCH;
    }
  });
});

describe('browserSession helpers', () => {
  it('builds a dedicated BahAI chrome profile path', () => {
    const profileDir = buildDefaultBahaiChromeProfileDir();
    expect(profileDir).toContain(path.join('Application Support', 'bahAI', 'chrome-profile'));
  });

  it('detects unsupported CDP context management errors', () => {
    expect(
      isCdpContextManagementError(
        new Error('browserType.connectOverCDP: Protocol error (Browser.setDownloadBehavior): Browser context management is not supported.')
      )
    ).toBe(true);
  });

  it('does not classify unrelated CDP errors as context-management failures', () => {
    expect(
      isCdpContextManagementError(
        new Error('connect ECONNREFUSED 127.0.0.1:9222')
      )
    ).toBe(false);
  });

  it('keeps browser launch code on explicit real-chrome failures', () => {
    const err = createBrowserLaunchError('real_chrome_required', 'Real Chrome launch failed');
    expect(err.browserLaunchCode).toBe('real_chrome_required');
  });

  it('falls back to persistent launch when CDP attach lacks context management support', async () => {
    const playwright = await import('playwright');
    const originalConnectOverCDP = playwright.chromium.connectOverCDP;
    const originalLaunchPersistentContext = playwright.chromium.launchPersistentContext;
    const originalCreateConnection = net.createConnection;

    const fakeContext = {
      browser: () => ({ close: async () => {} }),
      pages: () => [],
      newPage: async () => ({ goto: async () => {}, title: async () => '' }),
      close: async () => {}
    };

    net.createConnection = (_options, onConnect) => {
      const socket = {
        setTimeout() {},
        on(event, handler) {
          if (event === 'error' || event === 'timeout') {
            this[`_${event}`] = handler;
          }
          return this;
        },
        destroy() {}
      };
      process.nextTick(() => {
        if (typeof onConnect === 'function') onConnect();
      });
      return socket;
    };

    playwright.chromium.connectOverCDP = async () => {
      throw new Error('browserType.connectOverCDP: Protocol error (Browser.setDownloadBehavior): Browser context management is not supported.');
    };
    playwright.chromium.launchPersistentContext = async () => fakeContext;

    try {
      const session = await getSession('test-cdp-persistent-fallback', {
        cdpUrl: 'http://127.0.0.1:9222',
        executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        visible: true
      });
      expect(session.openedVia).toBe('persistent_fallback');
      expect(session.launchWarning).toContain('fell back to persistent launch');
    } finally {
      net.createConnection = originalCreateConnection;
      playwright.chromium.connectOverCDP = originalConnectOverCDP;
      playwright.chromium.launchPersistentContext = originalLaunchPersistentContext;
      await closeAllSessions();
    }
  });
});
