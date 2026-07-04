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

function buildGuiBrowserOpenArgs({
  url,
  sessionId,
  guiBrowserMode = 'cdp',
  guiBrowserPath = '',
  guiBrowserCdpUrl = '',
  defaultCdpUrl = 'http://127.0.0.1:9222',
  fallbackChromePath = '',
  installedBrowsers = []
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

  if (policy.mode === 'cdp') {
    return {
      ...base,
      cdpUrl: policy.cdpUrl
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
  isSeoGuiCheckpointRequest,
  buildGuiBrowserOpenArgs,
  shouldAdvertiseScreenAgent,
  getGuiCapabilityHints
};
