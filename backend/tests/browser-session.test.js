import { describe, it, expect } from 'vitest';

const { isCdpContextManagementError } = require('../browserSession');
const { createBrowserLaunchError } = require('../browserSession');
const { getSession, closeAllSessions, buildDefaultBahaiChromeProfileDir } = require('../browserSession');
const path = require('path');

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
});
