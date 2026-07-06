const { resolveGuiBrowserPolicy } = require('./browserPolicy');
const { buildGuiCapabilityStatus } = require('./capabilityStatus');

function isGuiObserveSelfTestRequest(text = '') {
  const value = String(text || '').toLowerCase();
  return (
    /(gui|browser|screenshot|müşahidə|observation|observe|workflow:\s*gui)/i.test(value) &&
    /(example\.com|test et|screenshot götür|heç bir riskli action|riskli action etmədən)/i.test(value)
  );
}

function isGuiLoginCheckpointRequest(text = '') {
  const value = String(text || '').toLowerCase();
  return (
    /(gui|browser|visible|workflow:\s*gui)/i.test(value) &&
    /(wix\.com|login olana qədər|login olana qeder|mən login|men login|login-dən sonra|login bitəndən sonra)/i.test(value)
  );
}

function isSeoGuiCheckpointRequest(text = '', workflow = '') {
  const value = String(text || '').toLowerCase();
  return (
    workflow === 'seo_gui' ||
    (/(seo|meta|title|sitemap|robots|search console|marketing)/i.test(value) &&
      /(gui|browser|visible|wix|dashboard|settings|workflow:\s*seo_gui)/i.test(value))
  );
}

function isGuiLoginResumeRequest(text = '') {
  const value = String(text || '').toLowerCase();
  return (
    /(login oldum|daxil oldum|logged in)/i.test(value) &&
    /(wix|seo settings|seo ayar|workflow:\s*gui|observe)/i.test(value)
  );
}

function extractUrlFromGuiRequest(text = '') {
  const value = String(text || '').trim();
  const explicitUrl = value.match(/https?:\/\/[^\s)]+/i);
  if (explicitUrl?.[0]) return explicitUrl[0];
  const bareDomain = value.match(/\b(?:www\.)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s)]*)?\b/i);
  if (!bareDomain?.[0]) return '';
  const domain = bareDomain[0];
  return /^https?:\/\//i.test(domain) ? domain : `https://${domain}`;
}

function isGuiOpenAndAwaitRequest(text = '') {
  const value = String(text || '').toLowerCase();
  if (!/(gui|browser|chrome|workflow:\s*gui)/i.test(value)) return false;
  if (isGuiLoginCheckpointRequest(value) || isGuiObserveSelfTestRequest(value) || isGuiLoginResumeRequest(value)) return false;
  if (!/(aç|ac|open|daxil ol|get|gir)/i.test(value)) return false;
  return Boolean(extractUrlFromGuiRequest(value));
}

function isGuiContinuationRequest(text = '') {
  const value = String(text || '').toLowerCase();
  if (extractUrlFromGuiRequest(value)) return false;
  if (isGuiLoginResumeRequest(value) || isGuiLoginCheckpointRequest(value) || isGuiObserveSelfTestRequest(value)) return false;
  return /(axtar|search|tap|filter|filtr|qiymət|qiymet|sort|sırala|sirala|click|klik|bax|observe|goster|göstər|ara)/i.test(value);
}

function buildGuiBrowserOpenArgs({
  url,
  sessionId,
  guiBrowserMode = 'persistent',
  guiBrowserPath = '',
  guiBrowserCdpUrl = '',
  defaultCdpUrl = 'http://127.0.0.1:9222',
  fallbackChromePath = '',
  installedBrowsers = [],
  preferPersistentIfChrome = false
}) {
  const base = {
    url,
    sessionId,
    visible: true,
    slowMoMs: 700
  };

  const policy = resolveGuiBrowserPolicy({
    guiBrowserMode,
    guiBrowserPath,
    guiBrowserCdpUrl,
    defaultCdpUrl,
    fallbackChromePath,
    installedBrowsers
  });

  const preferredChromePath = policy.browserPath || fallbackChromePath || guiBrowserPath || '';
  if (preferPersistentIfChrome) {
    const persistentArgs = {
      ...base,
      browserChannel: 'chrome',
      persistent: true
    };
    if (preferredChromePath) {
      persistentArgs.executablePath = preferredChromePath;
    }
    return persistentArgs;
  }

  if (policy.mode === 'cdp') {
    return {
      ...base,
      cdpUrl: policy.cdpUrl,
      executablePath: policy.browserPath || undefined,
      browserChannel: policy.browserPath ? 'chrome' : undefined
    };
  }

  if (policy.mode === 'persistent') {
    return {
      ...base,
      executablePath: policy.browserPath,
      browserChannel: 'chrome',
      persistent: true
    };
  }

  return base;
}

function shouldAdvertiseScreenAgent({
  latestUserText = '',
  workflow = '',
  guiCapabilities = null
} = {}) {
  const wantsRealScreenAutomation = /(real browser|real chrome|ekran agenti|screen agent|desktop automation|kompyuteri idare et|kompüteri idarə et|mouse ve keyboard|mouse və keyboard)/i.test(String(latestUserText || ''));
  if (workflow === 'screen' || wantsRealScreenAutomation) {
    if (!guiCapabilities) return true;
    return Boolean(guiCapabilities.screenAgent?.available);
  }
  return false;
}

function getGuiCapabilityHints(options = {}) {
  const status = buildGuiCapabilityStatus(options);
  return {
    status,
    browserReady: Boolean(status.browser?.automationAvailable),
    screenReady: Boolean(status.screenAgent?.available),
    browserOnlyReason: !status.screenAgent?.available
      ? 'screen_agent_unavailable'
      : ''
  };
}

module.exports = {
  isGuiObserveSelfTestRequest,
  isGuiLoginCheckpointRequest,
  isGuiLoginResumeRequest,
  isGuiOpenAndAwaitRequest,
  isGuiContinuationRequest,
  extractUrlFromGuiRequest,
  isSeoGuiCheckpointRequest,
  buildGuiBrowserOpenArgs,
  shouldAdvertiseScreenAgent,
  getGuiCapabilityHints
};
