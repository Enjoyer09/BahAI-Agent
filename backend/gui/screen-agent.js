// ==========================================
// Screen Agent — TeamViewer/AnyDesk style GUI automation
//
// Instead of controlling a browser via Playwright/CDP, this agent
// controls the actual screen using pyautogui (mouse + keyboard).
// It "sees" by taking real screenshots and uses AI to decide actions.
//
// Benefits:
// - No "unsafe browser" detection by Google
// - Works with ANY application (not just Chrome)
// - User sees everything in real-time
// - No automation flags, no Playwright, no CDP
// ==========================================

const { execFile, spawn } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const fs = require('fs/promises');

const execFileAsync = promisify(execFile);
const PYTHON = path.resolve(__dirname, '../../.venv/bin/python3');
const SCREENSHOT_DIR = path.resolve(__dirname, '../../sandbox/screen-agent');

// SEC: Never interpolate LLM-controlled values into the Python source string.
// Payloads are passed as a JSON argv argument and decoded with json.loads so
// strings like `x'); import os; os.system(...) #` stay inert data, not code.
async function runPy(script, payload = {}, timeoutMs = 5000) {
  const { stdout } = await execFileAsync(
    PYTHON,
    ['-c', script, JSON.stringify(payload)],
    { timeout: timeoutMs }
  );
  return stdout;
}

const BOUNDED_INT = (value, fallback, min, max) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
};

/**
 * Take a screenshot of the entire screen.
 * Returns the screenshot as a base64 PNG string.
 */
async function takeScreenshot() {
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
  const filename = `screen-${Date.now()}.png`;
  const filepath = path.join(SCREENSHOT_DIR, filename);

  await execFileAsync(PYTHON, ['-c', `
import pyautogui
screenshot = pyautogui.screenshot()
screenshot.save("${filepath.replace(/"/g, '\\"')}")
print("OK")
  `], { timeout: 10000 });

  const buffer = await fs.readFile(filepath);
  return {
    path: filepath,
    base64: buffer.toString('base64'),
    timestamp: Date.now()
  };
}

/**
 * Get current mouse position and screen size.
 */
async function getScreenInfo() {
  const { stdout } = await execFileAsync(PYTHON, ['-c', `
import pyautogui, json
info = {
    "screen": {"width": pyautogui.size().width, "height": pyautogui.size().height},
    "mouse": {"x": pyautogui.position().x, "y": pyautogui.position().y}
}
print(json.dumps(info))
  `], { timeout: 5000 });
  return JSON.parse(stdout.trim());
}

/**
 * Execute a mouse click at given coordinates.
 */
async function mouseClick(x, y, options = {}) {
  const { clicks = 1, button = 'left' } = options;
  await runPy(`
import pyautogui, time
import sys, json
p = json.loads(sys.argv[1])
pyautogui.click(p["x"], p["y"], clicks=p["clicks"], button=p["button"])
time.sleep(0.3)
print("OK")
`, {
    x: BOUNDED_INT(x, 0, 0, 100000),
    y: BOUNDED_INT(y, 0, 0, 100000),
    clicks: BOUNDED_INT(clicks, 1, 1, 20),
    button: ['left', 'right', 'middle'].includes(String(button)) ? String(button) : 'left',
  });
  return { ok: true, action: 'click', x, y, button, clicks };
}

/**
 * Move mouse to coordinates (without clicking).
 */
async function mouseMove(x, y) {
  await runPy(`
import pyautogui
import sys, json
p = json.loads(sys.argv[1])
pyautogui.moveTo(p["x"], p["y"], duration=0.3)
print("OK")
`, {
    x: BOUNDED_INT(x, 0, 0, 100000),
    y: BOUNDED_INT(y, 0, 0, 100000),
  });
  return { ok: true, action: 'move', x, y };
}

/**
 * Type text using keyboard.
 * For Unicode/special characters, uses clipboard paste.
 */
async function typeText(text, options = {}) {
  const { interval = 0.02, useClipboard = false } = options;
  const safeText = String(text || '').slice(0, 2000);

  if (useClipboard || /[^\x00-\x7F]/.test(safeText)) {
    // Unicode — use clipboard
    await runPy(`
import pyautogui, pyperclip, time, sys, json
pyperclip.copy(json.loads(sys.argv[1])["text"])
pyautogui.hotkey('command', 'v')
time.sleep(0.3)
print("OK")
    `, { text: safeText });
  } else {
    await runPy(`
import pyautogui, time, sys, json
p = json.loads(sys.argv[1])
pyautogui.write(p["text"], interval=p["interval"])
time.sleep(0.2)
print("OK")
    `, { text: safeText, interval: Math.min(1, Math.max(0, Number(interval) || 0.02)) }, 10000);
  }
  return { ok: true, action: 'type', text: safeText.slice(0, 50) };
}

/**
 * Press a key or key combination.
 */
async function pressKey(key) {
  // Handle combinations like "command+a", "ctrl+c"
  const keys = String(key || 'enter')
    .split('+')
    .map((k) => k.trim().toLowerCase())
    .filter((k) => /^[a-z0-9 ]{1,32}$/.test(k))
    .slice(0, 6);
  if (keys.length === 0) keys.push('enter');

  await runPy(`
import pyautogui, time, sys, json
pyautogui.hotkey(*json.loads(sys.argv[1])["keys"])
time.sleep(0.3)
print("OK")
  `, { keys });
  return { ok: true, action: 'press', key: keys.join('+') };
}

/**
 * Scroll at current position or specific coordinates.
 */
async function scroll(amount, options = {}) {
  const { x, y } = options;
  const payload = { amount: BOUNDED_INT(amount, -3, -1000, 1000) };
  if (x != null && y != null && Number.isFinite(Number(x)) && Number.isFinite(Number(y))) {
    payload.x = BOUNDED_INT(x, 0, 0, 100000);
    payload.y = BOUNDED_INT(y, 0, 0, 100000);
  }

  await runPy(`
import pyautogui, time, sys, json
p = json.loads(sys.argv[1])
if "x" in p and "y" in p:
    pyautogui.moveTo(p["x"], p["y"])
    time.sleep(0.2)
pyautogui.scroll(p["amount"])
time.sleep(0.3)
print("OK")
  `, payload);
  return { ok: true, action: 'scroll', amount, x, y };
}

/**
 * Open a URL in the default browser (normal, not automated).
 */
async function openUrl(url) {
  if (process.platform === 'darwin') {
    await execFileAsync('/usr/bin/open', [url]).catch(() => execFileAsync('open', [url]));
  } else if (process.platform === 'win32') {
    await execFileAsync('cmd.exe', ['/c', 'start', '', url]);
  } else {
    await execFileAsync('xdg-open', [url]).catch(() => execFileAsync('sensible-browser', [url]));
  }
  // Wait for browser to open and page to start loading
  await new Promise(r => setTimeout(r, 3000));
  return { ok: true, action: 'open_url', url };
}

/**
 * Open an application by name.
 */
async function openApp(appName) {
  if (process.platform === 'darwin') {
    await execFileAsync('/usr/bin/open', ['-a', appName]).catch(() => execFileAsync('open', ['-a', appName]));
  } else if (process.platform === 'win32') {
    await execFileAsync('cmd.exe', ['/c', 'start', '', appName]);
  } else {
    await execFileAsync('xdg-open', [appName]).catch(() => execFileAsync('gtk-launch', [appName]));
  }
  await new Promise(r => setTimeout(r, 2000));
  return { ok: true, action: 'open_app', app: appName };
}

/**
 * Execute a screen agent action.
 * This is the main dispatcher — receives actions from the AI and executes them.
 */
async function executeScreenAction(action = {}) {
  const type = String(action.type || '').trim();

  switch (type) {
    case 'screenshot':
      return takeScreenshot();

    case 'click':
      return mouseClick(Number(action.x), Number(action.y), {
        clicks: action.clicks || 1,
        button: action.button || 'left'
      });

    case 'double_click':
      return mouseClick(Number(action.x), Number(action.y), { clicks: 2 });

    case 'right_click':
      return mouseClick(Number(action.x), Number(action.y), { button: 'right' });

    case 'move':
      return mouseMove(Number(action.x), Number(action.y));

    case 'type':
      return typeText(String(action.text || ''), { useClipboard: action.useClipboard });

    case 'press':
      return pressKey(String(action.key || 'enter'));

    case 'scroll':
      return scroll(Number(action.amount || -3), { x: action.x, y: action.y });

    case 'open_url':
      return openUrl(String(action.url));

    case 'open_app':
      return openApp(String(action.app));

    case 'wait':
      await new Promise(r => setTimeout(r, Number(action.ms || 1000)));
      return { ok: true, action: 'wait', ms: action.ms || 1000 };

    case 'done':
      return { ok: true, action: 'done', done: true };

    default:
      return { ok: false, action: type, error: `Unknown screen action: ${type}` };
  }
}

/**
 * Full observe-act cycle:
 * 1. Take screenshot
 * 2. Send to AI for analysis
 * 3. Get next action
 * 4. Execute action
 * 5. Return result + new screenshot
 */
async function observeAndAct({ goal, getNextAction, history = [] }) {
  // 1. Observe — take screenshot
  const screenshot = await takeScreenshot();
  const screenInfo = await getScreenInfo();

  // 2. Ask AI what to do
  const observation = {
    screenshot: screenshot.base64,
    screenshotPath: screenshot.path,
    screenSize: screenInfo.screen,
    mousePosition: screenInfo.mouse,
    timestamp: screenshot.timestamp
  };

  const decision = await getNextAction({
    goal,
    observation,
    history: history.slice(-6)
  });

  if (!decision || decision.type === 'done') {
    return { observation, action: decision, result: { ok: true, done: true }, history };
  }

  // 3. Execute the action
  const result = await executeScreenAction(decision);

  // 4. Take after-screenshot
  await new Promise(r => setTimeout(r, 800));
  const afterScreenshot = await takeScreenshot();

  return {
    observation,
    action: decision,
    result,
    afterScreenshot,
    history: [...history, { action: decision, result, timestamp: Date.now() }].slice(-10)
  };
}

module.exports = {
  takeScreenshot,
  getScreenInfo,
  mouseClick,
  mouseMove,
  typeText,
  pressKey,
  scroll,
  openUrl,
  openApp,
  executeScreenAction,
  observeAndAct,
  PYTHON,
  SCREENSHOT_DIR
};
