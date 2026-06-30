function normalizeGuiBrowserMode(mode = '') {
  const value = String(mode || '').trim().toLowerCase();
  if (value === 'persistent' || value === 'bundled' || value === 'cdp') {
    return value;
  }
  return 'cdp';
}

function resolveGuiBrowserPolicy({
  guiBrowserMode = 'cdp',
  guiBrowserPath = '',
  guiBrowserCdpUrl = '',
  defaultCdpUrl = 'http://127.0.0.1:9222',
  fallbackChromePath = '',
  installedBrowsers = []
} = {}) {
  const normalizedMode = normalizeGuiBrowserMode(guiBrowserMode);
  const preferredInstalledBrowser = installedBrowsers.find((item) => item.installed && item.recommended)
    || installedBrowsers.find((item) => item.installed);
  const resolvedBrowserPath = String(guiBrowserPath || fallbackChromePath || preferredInstalledBrowser?.path || '').trim();
  const resolvedCdpUrl = String(guiBrowserCdpUrl || defaultCdpUrl || '').trim();
  const hasInstalledChrome = Boolean(resolvedBrowserPath);

  if (normalizedMode === 'persistent') {
    return {
      mode: hasInstalledChrome ? 'persistent' : 'bundled',
      browserPath: resolvedBrowserPath,
      cdpUrl: resolvedCdpUrl,
      supportsPersistent: hasInstalledChrome,
      supportsCdp: Boolean(resolvedCdpUrl)
    };
  }

  if (normalizedMode === 'bundled') {
    return {
      mode: 'bundled',
      browserPath: resolvedBrowserPath,
      cdpUrl: resolvedCdpUrl,
      supportsPersistent: hasInstalledChrome,
      supportsCdp: Boolean(resolvedCdpUrl)
    };
  }

  if (resolvedCdpUrl) {
    return {
      mode: 'cdp',
      browserPath: resolvedBrowserPath,
      cdpUrl: resolvedCdpUrl,
      supportsPersistent: hasInstalledChrome,
      supportsCdp: true
    };
  }

  return {
    mode: hasInstalledChrome ? 'persistent' : 'bundled',
    browserPath: resolvedBrowserPath,
    cdpUrl: resolvedCdpUrl,
    supportsPersistent: hasInstalledChrome,
    supportsCdp: false
  };
}

function getRecommendedGuiBrowserMode({ installedBrowsers = [], cdpUrl = '' } = {}) {
  return resolveGuiBrowserPolicy({
    guiBrowserMode: 'cdp',
    installedBrowsers,
    defaultCdpUrl: cdpUrl
  }).mode;
}

module.exports = {
  normalizeGuiBrowserMode,
  resolveGuiBrowserPolicy,
  getRecommendedGuiBrowserMode
};
