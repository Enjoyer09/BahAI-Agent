let chromiumImportPromise = null;
const sessions = new Map();
const fs = require('fs');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');

function createBrowserLaunchError(code, message, extra = {}) {
  const error = new Error(message);
  error.browserLaunchCode = code;
  Object.assign(error, extra);
  return error;
}

function isRealChromePreferred({ browserChannel = '', executablePath = '', persistent = false, cdpUrl = '' } = {}) {
  return Boolean(
    persistent ||
    String(browserChannel || '').trim() === 'chrome' ||
    String(executablePath || '').trim() ||
    String(cdpUrl || '').trim()
  );
}

const DEFAULT_CHROME_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/Applications/Chromium.app/Contents/MacOS/Chromium'
];

const KNOWN_BROWSER_APPS = [
  { id: 'chrome', name: 'Google Chrome', path: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', supportsCdp: true },
  { id: 'chrome-canary', name: 'Google Chrome Canary', path: '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary', supportsCdp: true },
  { id: 'chromium', name: 'Chromium', path: '/Applications/Chromium.app/Contents/MacOS/Chromium', supportsCdp: true },
  { id: 'edge', name: 'Microsoft Edge', path: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', supportsCdp: true },
  { id: 'brave', name: 'Brave Browser', path: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser', supportsCdp: true },
  { id: 'arc', name: 'Arc', path: '/Applications/Arc.app/Contents/MacOS/Arc', supportsCdp: false },
  { id: 'safari', name: 'Safari', path: '/Applications/Safari.app/Contents/MacOS/Safari', supportsCdp: false },
  { id: 'firefox', name: 'Firefox', path: '/Applications/Firefox.app/Contents/MacOS/firefox', supportsCdp: false }
];

async function isCdpReachable(cdpUrl) {
  try {
    const parsed = new URL(cdpUrl);
    const hostname = parsed.hostname || '127.0.0.1';
    const port = Number(parsed.port || 9222);
    await new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: hostname, port }, () => {
        socket.destroy();
        resolve(true);
      });
      socket.setTimeout(800);
      socket.on('error', reject);
      socket.on('timeout', () => reject(new Error('timeout')));
    });
    return true;
  } catch {
    return false;
  }
}

function resolveChromeDebugProfileDir(env = process.env) {
  return String(
    env.GUI_BROWSER_CHROME_PROFILE ||
    path.join(env.HOME || '/tmp', 'Library', 'Application Support', 'Google', 'Chrome')
  );
}

async function ensureDebugChrome(cdpUrl, userDataDir) {
  if (!cdpUrl) return { launched: false };
  if (await isCdpReachable(cdpUrl)) return { launched: false };

  // Test/CI guard: never auto-launch a real browser from a headless test or
  // CI environment. Fail fast with a deterministic cdp_unreachable error
  // instead of spawning visible Chrome with a profile dir (which can lock the
  // user's real profile and race the CDP reachability deadline).
  if (process.env.GUI_BROWSER_NO_AUTO_LAUNCH === 'true') {
    throw createBrowserLaunchError(
      'cdp_unreachable',
      `Chrome CDP is not reachable at ${cdpUrl} and auto-launch is disabled (GUI_BROWSER_NO_AUTO_LAUNCH=true).`,
      { cdpUrl }
    );
  }

  const chromePath = findInstalledChromePath();
  if (!chromePath) {
    throw createBrowserLaunchError('chrome_missing', 'No installed Chrome found for CDP mode', {
      cdpUrl
    });
  }

  const parsed = new URL(cdpUrl);
  const port = String(parsed.port || '9222');
  
  // FIX: Use a dedicated profile dir that mimics real Chrome behavior.
  // Google blocks login on Playwright's bundled Chromium because of automation flags.
  // By launching real Chrome with minimal flags + a persistent user-data-dir,
  // Google treats it as a normal browser and allows OAuth login.
  //
  // IMPORTANT: Use the user's REAL Chrome profile so Google sees existing
  // cookies/history and doesn't flag it as "unsafe browser". Tests/CI must
  // override via GUI_BROWSER_CHROME_PROFILE (resolveChromeDebugProfileDir) so
  // automated runs never touch the real profile.
  const realProfileDir = resolveChromeDebugProfileDir(process.env);
  // Don't create this dir — it must already exist (user's real profile)

  const child = spawn(chromePath, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${realProfileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    // NOTE: Do NOT add --no-sandbox, --disable-extensions, etc.
    // Google detects those as "unsafe browser" and blocks OAuth.
    'about:blank'
  ], {
    detached: true,
    stdio: 'ignore'
  });
  child.unref();

  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (await isCdpReachable(cdpUrl)) {
      return { launched: true, chromePath, port, profileDir: realProfileDir };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw createBrowserLaunchError('cdp_unreachable', `Chrome CDP did not become reachable at ${cdpUrl}`, {
    cdpUrl,
    chromePath,
    profileDir: realProfileDir
  });
}

async function getChromium() {
  if (!chromiumImportPromise) {
    chromiumImportPromise = import('playwright')
      .then((mod) => mod.chromium)
      .catch((error) => {
        throw createBrowserLaunchError('playwright_missing', `Playwright import failed: ${error.message}`);
      });
  }
  return chromiumImportPromise;
}

function isCdpContextManagementError(error) {
  const message = String(error?.message || '');
  return /Browser\.setDownloadBehavior/i.test(message) || /context management is not supported/i.test(message);
}

function findInstalledChromePath() {
  for (const candidate of DEFAULT_CHROME_PATHS) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return '';
}

function buildDefaultBahaiChromeProfileDir() {
  return path.join(
    process.env.HOME || '/tmp',
    'Library',
    'Application Support',
    'bahAI',
    'chrome-profile'
  );
}

function listInstalledBrowsers() {
  return KNOWN_BROWSER_APPS.map((browser) => ({
    ...browser,
    installed: fs.existsSync(browser.path),
    recommended: browser.id === 'chrome'
  }));
}

async function getSession(sessionId = 'default', options = {}) {
  const hasExplicitLaunchOptions = Object.keys(options || {}).some((key) => options[key] !== undefined && options[key] !== '');
  if (sessions.has(sessionId) && !hasExplicitLaunchOptions) {
    return sessions.get(sessionId);
  }

  const chromium = await getChromium();
  const requestedPersistent = Boolean(options.persistent || process.env.GUI_BROWSER_PERSISTENT === 'true');
  const requestedBrowserChannel = String(options.browserChannel || process.env.GUI_BROWSER_CHANNEL || '').trim();
  let requestedExecutablePath = String(options.executablePath || process.env.GUI_BROWSER_EXECUTABLE_PATH || '').trim();
  if (!requestedExecutablePath && requestedBrowserChannel === 'chrome') {
    requestedExecutablePath = findInstalledChromePath();
  }
  const shouldIgnoreEnvCdp = requestedPersistent || Boolean(requestedBrowserChannel) || Boolean(requestedExecutablePath);
  const rawCdpUrl = options.cdpUrl !== undefined
    ? options.cdpUrl
    : (shouldIgnoreEnvCdp ? '' : process.env.GUI_BROWSER_CDP_URL || '');
  const cdpUrl = String(rawCdpUrl || '').trim();
  const visible = Boolean(options.visible || process.env.GUI_BROWSER_VISIBLE === 'true');
  const slowMo = Number.isFinite(Number(options.slowMoMs || process.env.GUI_BROWSER_SLOW_MO_MS))
    ? Number(options.slowMoMs || process.env.GUI_BROWSER_SLOW_MO_MS)
    : 0;
  const browserChannel = requestedBrowserChannel;
  let executablePath = requestedExecutablePath;
  // FIX: Prefer CDP mode when CDP URL is configured. This ensures we use real Chrome
  // (not Playwright's bundled Chromium) which allows Google OAuth login.
  // Only fall back to persistent Playwright if no CDP URL is available.
  const hasCdpUrl = Boolean(cdpUrl);
  const persistent = !hasCdpUrl && requestedPersistent;
  const userDataDir = String(
    options.userDataDir ||
    process.env.GUI_BROWSER_USER_DATA_DIR ||
    buildDefaultBahaiChromeProfileDir()
  );
  const sessionSignature = JSON.stringify({
    cdpUrl,
    visible,
    slowMo,
    browserChannel,
    executablePath,
    persistent,
    userDataDir: persistent ? userDataDir : ''
  });

  if (sessions.has(sessionId)) {
    const existing = sessions.get(sessionId);
    if (existing.sessionSignature === sessionSignature) {
      return existing;
    }
    await existing.context?.close?.().catch(() => {});
    await existing.browser?.close?.().catch(() => {});
    sessions.delete(sessionId);
  }

  const launchOptions = {
    headless: !visible,
    slowMo,
  };
  if (browserChannel && !executablePath) {
    launchOptions.channel = browserChannel;
  }
  if (executablePath) {
    launchOptions.executablePath = executablePath;
  }
  let launchWarning = '';
  let browser;
  let context;
  let cdpAttached = false;
  let openedVia = 'bundled';
  const preferRealChrome = isRealChromePreferred({ browserChannel, executablePath, persistent, cdpUrl });

  // Test/CI guard: GUI_BROWSER_NO_AUTO_LAUNCH=true means NO browser subprocess
  // may be spawned from an automated environment — applied here to the
  // persistent (real Chrome via launchPersistentContext) and bundled Playwright
  // paths, mirroring the existing guard inside ensureDebugChrome for CDP
  // auto-launch. Placed after the session cache check (existing live sessions
  // are reused) and before the lock-file/profile dir cleanup so tests stay
  // fully side-effect-free.
  if (process.env.GUI_BROWSER_NO_AUTO_LAUNCH === 'true' && !hasCdpUrl) {
    throw createBrowserLaunchError(
      'cdp_unreachable',
      `Code: cdp_unreachable. Browser launch is disabled in this environment (GUI_BROWSER_NO_AUTO_LAUNCH=true); no browser process was opened (persistent/bundled mode).`,
      { cdpUrl, browserChannel, executablePath, persistent, userDataDir }
    );
  }

  // FIX: Clear stale Chrome singleton lock files before launching persistent context.
  // These locks remain if Chrome crashed or was force-killed, preventing relaunch.
  if (persistent && userDataDir) {
    try { fs.mkdirSync(userDataDir, { recursive: true }); } catch { /* ignore */ }
    const lockFiles = ['SingletonLock', 'SingletonSocket', 'SingletonCookie'];
    for (const lockFile of lockFiles) {
      try { fs.unlinkSync(path.join(userDataDir, lockFile)); } catch { /* ignore */ }
    }
  }

  try {
    if (cdpUrl) {
      const boot = await ensureDebugChrome(cdpUrl, userDataDir);
      if (boot.launched) {
        launchWarning = `Started Chrome on demand for CDP attach: ${boot.chromePath}`;
      }
      try {
        browser = await chromium.connectOverCDP(cdpUrl);
        cdpAttached = true;
        context = browser.contexts()[0] || null;
        openedVia = 'cdp';
      } catch (cdpError) {
        if (!isCdpContextManagementError(cdpError)) {
          throw cdpError;
        }
        const fallbackChromePath = executablePath || findInstalledChromePath();
        if (!fallbackChromePath) {
          throw createBrowserLaunchError(
            'real_chrome_required',
            cdpError.message,
            {
              cdpUrl,
              browserChannel,
              executablePath,
              persistent,
              userDataDir
            }
          );
        }
        // Test/CI guard: never fall back to spawning Chrome from an automated
        // environment (mirrors the guard against persistent/bundled launches).
        if (process.env.GUI_BROWSER_NO_AUTO_LAUNCH === 'true') {
          throw createBrowserLaunchError(
            'cdp_unreachable',
            `Code: cdp_unreachable. Browser launch is disabled in this environment (GUI_BROWSER_NO_AUTO_LAUNCH=true); refusing persistent fallback launch after CDP attach failure.`,
            { cdpUrl, browserChannel, executablePath, persistent, userDataDir }
          );
        }
        launchWarning = [
          launchWarning,
          `CDP attach unsupported by this Chrome session, fell back to persistent launch: ${cdpError.message}`
        ].filter(Boolean).join(' | ');
        context = await chromium.launchPersistentContext(userDataDir, {
          ...launchOptions,
          executablePath: fallbackChromePath,
          viewport: { width: 1440, height: 960 }
        });
        browser = context.browser();
        executablePath = fallbackChromePath;
        openedVia = 'persistent_fallback';
      }
    } else if (persistent) {
      context = await chromium.launchPersistentContext(userDataDir, {
        ...launchOptions,
        viewport: { width: 1440, height: 960 }
      });
      browser = context.browser();
      openedVia = 'persistent';
    } else {
      browser = await chromium.launch(launchOptions);
      openedVia = executablePath || browserChannel ? 'requested_browser_fallback' : 'bundled';
    }
  } catch (error) {
    // FIX: If persistent launch fails with "existing browser session",
    // kill orphan Chrome processes using that profile and retry once.
    if (persistent && String(error.message || '').includes('existing browser session')) {
      try {
        const { execSync } = require('child_process');
        execSync(`pkill -f "${userDataDir.replace(/"/g, '')}" 2>/dev/null || true`);
        await new Promise(r => setTimeout(r, 1500));
        // Clear locks again
        const lockFiles = ['SingletonLock', 'SingletonSocket', 'SingletonCookie'];
        for (const lockFile of lockFiles) {
          try { fs.unlinkSync(path.join(userDataDir, lockFile)); } catch { /* ignore */ }
        }
        context = await chromium.launchPersistentContext(userDataDir, {
          ...launchOptions,
          viewport: { width: 1440, height: 960 }
        });
        browser = context.browser();
        launchWarning = 'Recovered from stale browser session (killed orphan process).';
        openedVia = 'persistent_recovered';
      } catch (retryError) {
        throw createBrowserLaunchError(
          'real_chrome_profile_locked',
          retryError.message || 'Chrome profile is locked by another running session.',
          {
            browserChannel,
            executablePath,
            persistent,
            userDataDir
          }
        );
      }
    } else if (!browserChannel && !executablePath) {
      throw createBrowserLaunchError(
        error.browserLaunchCode || 'browser_launch_failed',
        error.message,
        {
          cdpUrl,
          browserChannel,
          executablePath,
          persistent,
          userDataDir
        }
      );
    } else if (preferRealChrome) {
      throw createBrowserLaunchError(
        error.browserLaunchCode || 'real_chrome_required',
        error.message,
        {
          cdpUrl,
          browserChannel,
          executablePath,
          persistent,
          userDataDir
        }
      );
    } else {
      throw createBrowserLaunchError(
        error.browserLaunchCode || 'browser_launch_failed',
        error.message,
        {
          cdpUrl,
          browserChannel,
          executablePath,
          persistent,
          userDataDir
        }
      );
    }
  }
  if (!context && !cdpAttached) {
    context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  }

  let page = null;
  if (context) {
    const existingPages = context.pages();
    page = existingPages[0] || await context.newPage();
  } else if (cdpAttached) {
    const contexts = browser.contexts();
    for (const candidateContext of contexts) {
      const candidatePages = candidateContext.pages();
      if (candidatePages[0]) {
        context = candidateContext;
        page = candidatePages[0];
        break;
      }
    }

    if (!page) {
      const fallbackContext = contexts[0];
      if (!fallbackContext) {
        throw new Error('CDP attached to Chrome, but no browser context is available.');
      }
      context = fallbackContext;
      page = await fallbackContext.newPage();
    }
  }

  const session = {
    browser,
    context,
    page,
    sessionId,
    createdAt: Date.now(),
    cdpUrl,
    visible,
    slowMo,
    browserChannel,
    executablePath,
    persistent,
    userDataDir,
    launchWarning,
    sessionSignature,
    cdpAttached,
    openedVia
  };
  sessions.set(sessionId, session);
  return session;
}

async function closeAllSessions() {
  for (const session of sessions.values()) {
    if (!session.cdpAttached) {
      await session.context?.close?.().catch(() => {});
      await session.browser?.close?.().catch(() => {});
    }
  }
  sessions.clear();
}

function hasSession(sessionId = 'default') {
  return sessions.has(sessionId);
}

module.exports = {
  getSession,
  hasSession,
  closeAllSessions,
  findInstalledChromePath,
  buildDefaultBahaiChromeProfileDir,
  resolveChromeDebugProfileDir,
  listInstalledBrowsers,
  isCdpContextManagementError,
  createBrowserLaunchError
};
