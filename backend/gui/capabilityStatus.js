const fs = require('fs');
const path = require('path');
const { listInstalledBrowsers, findInstalledChromePath } = require('../browserSession');
const { resolveGuiBrowserPolicy } = require('./browserPolicy');
const { detectComputerUseStatus } = require('./computerUseStatus');

const SCREEN_AGENT_PYTHON = path.resolve(__dirname, '../../.venv/bin/python3');

function detectPlaywrightInstalled() {
  try {
    require.resolve('playwright');
    return true;
  } catch {
    return false;
  }
}

function detectScreenAgentStatus({ runtimePlatform = process.platform } = {}) {
  const pythonExists = fs.existsSync(SCREEN_AGENT_PYTHON);
  const openCommandAvailable = runtimePlatform === 'darwin';
  const supportedPlatform = runtimePlatform === 'darwin';
  const available = supportedPlatform && pythonExists && openCommandAvailable;

  const reasons = [];
  if (!supportedPlatform) reasons.push('screen_agent_macos_only');
  if (!pythonExists) reasons.push('screen_agent_python_missing');
  if (!openCommandAvailable) reasons.push('screen_open_command_unavailable');

  return {
    available,
    supportedPlatform,
    pythonPath: SCREEN_AGENT_PYTHON,
    pythonExists,
    openCommandAvailable,
    reasons
  };
}

function buildGuiCapabilityStatus({
  guiBrowserMode = 'persistent',
  guiBrowserPath = '',
  guiBrowserCdpUrl = '',
  defaultCdpUrl = process.env.GUI_BROWSER_CDP_URL || 'http://127.0.0.1:9222',
  fallbackChromePath = findInstalledChromePath(),
  runtimePlatform = process.platform,
  nodeEnv = process.env.NODE_ENV || '',
  railwayEnv = process.env.RAILWAY_ENVIRONMENT || '',
  railwayStaticUrl = process.env.RAILWAY_STATIC_URL || '',
  hostname = process.env.HOSTNAME || ''
} = {}) {
  const installedBrowsers = listInstalledBrowsers();
  const playwrightInstalled = detectPlaywrightInstalled();
  const screenAgent = detectScreenAgentStatus({ runtimePlatform });
  const computerUse = detectComputerUseStatus({ runtimePlatform });
  const policy = resolveGuiBrowserPolicy({
    guiBrowserMode,
    guiBrowserPath,
    guiBrowserCdpUrl,
    defaultCdpUrl,
    fallbackChromePath,
    installedBrowsers,
    runtimePlatform
  });

  const isRemoteLinux = runtimePlatform === 'linux' && (
    Boolean(railwayEnv) ||
    Boolean(railwayStaticUrl) ||
    /railway/i.test(hostname) ||
    nodeEnv === 'production'
  );

  const chromeInstalled = installedBrowsers.some((item) => item.installed && item.supportsCdp);
  const browserAutomationAvailable = playwrightInstalled;
  const browserModeStatus = policy.mode === 'bundled' && !playwrightInstalled
    ? 'missing'
    : (policy.mode === 'cdp' && !chromeInstalled ? 'degraded' : 'ok');

  const warnings = [];
  if (!playwrightInstalled) warnings.push('playwright_missing');
  if (policy.mode === 'cdp' && !chromeInstalled) warnings.push('chrome_missing_for_cdp');
  if (isRemoteLinux && !chromeInstalled) warnings.push('remote_linux_no_desktop_chrome');
  if (!screenAgent.available) warnings.push(...screenAgent.reasons);
  if (!computerUse.available) warnings.push(...computerUse.reasons);

  return {
    summary: {
      status: browserAutomationAvailable ? (warnings.length ? 'degraded' : 'ok') : 'missing',
      recommendedWorkflow: computerUse.available ? 'computer_use' : (browserAutomationAvailable ? 'gui' : 'default'),
      recommendedBrowserMode: policy.mode
    },
    runtime: {
      platform: runtimePlatform,
      nodeEnv,
      isRemoteLinux
    },
    browser: {
      automationAvailable: browserAutomationAvailable,
      playwrightInstalled,
      installedBrowsers,
      chromeInstalled,
      fallbackChromePath,
      requestedMode: guiBrowserMode,
      resolvedMode: policy.mode,
      modeStatus: browserModeStatus,
      cdpUrl: policy.cdpUrl,
      supportsPersistent: policy.supportsPersistent,
      supportsCdp: policy.supportsCdp
    },
    screenAgent,
    computerUse,
    warnings
  };
}

module.exports = {
  buildGuiCapabilityStatus,
  detectPlaywrightInstalled,
  detectScreenAgentStatus,
  SCREEN_AGENT_PYTHON
};
