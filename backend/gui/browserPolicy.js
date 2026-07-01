function normalizeGuiBrowserMode(mode = '') {
  const value = String(mode || '').trim().toLowerCase();
  if (value === 'persistent' || value === 'bundled' || value === 'cdp') {
    return value;
  }
  return 'cdp';
}

function shouldPreferCdp({
  installedBrowsers = [],
  cdpUrl = '',
  runtimePlatform = process.platform
} = {}) {
  const hasCdpUrl = Boolean(String(cdpUrl || '').trim());
  if (!hasCdpUrl) return false;

  const hasInstalledChrome = installedBrowsers.some((item) => item?.installed && item?.supportsCdp);
  if (hasInstalledChrome) return true;

  // On remote Linux containers, a loopback CDP URL often exists in config but
  // there is no real desktop Chrome to attach to. Prefer bundled there.
  if (runtimePlatform === 'linux') {
    return false;
  }

  return true;
}

function resolveGuiBrowserPolicy({
  guiBrowserMode = 'cdp',
  guiBrowserPath = '',
  guiBrowserCdpUrl = '',
  defaultCdpUrl = 'http://127.0.0.1:9222',
  fallbackChromePath = '',
  installedBrowsers = [],
  runtimePlatform = process.platform
} = {}) {
  const normalizedMode = normalizeGuiBrowserMode(guiBrowserMode);
  const preferredInstalledBrowser = installedBrowsers.find((item) => item.installed && item.recommended)
    || installedBrowsers.find((item) => item.installed);
  const resolvedBrowserPath = String(guiBrowserPath || fallbackChromePath || preferredInstalledBrowser?.path || '').trim();
  const resolvedCdpUrl = String(guiBrowserCdpUrl || defaultCdpUrl || '').trim();
  const hasInstalledChrome = Boolean(resolvedBrowserPath);
  const allowCdp = shouldPreferCdp({
    installedBrowsers,
    cdpUrl: resolvedCdpUrl,
    runtimePlatform
  });

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

  if (allowCdp) {
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
  getRecommendedGuiBrowserMode,
  shouldPreferCdp
};
