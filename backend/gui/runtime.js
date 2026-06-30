const path = require('path');
const fs = require('fs/promises');
const { getSession } = require('../browserSession');
const { groundElement, ocrTextGround, reflectOnAction } = require('./grounding');

async function captureObservation({ sessionId = 'default', workingDirectory }) {
  const session = await getSession(sessionId);
  const outputDir = path.resolve(workingDirectory, 'sandbox', 'gui-agent');
  await fs.mkdir(outputDir, { recursive: true });
  const screenshotPath = path.join(outputDir, `gui-shot-${Date.now()}.png`);
  await session.page.screenshot({
    path: screenshotPath,
    fullPage: false // viewport only — matches Agent-S behavior
  });
  const screenshotBuffer = await fs.readFile(screenshotPath);
  const title = await session.page.title().catch(() => '');
  const url = session.page.url();
  return {
    sessionId,
    title,
    url,
    screenshotPath,
    screenshotBase64: screenshotBuffer.toString('base64'),
    timestamp: Date.now()
  };
}

async function executeGuiAction({ sessionId = 'default', action }) {
  const session = await getSession(sessionId);
  const type = String(action?.type || '').trim();

  // Agent-S style: coordinate-based click (no selector needed)
  if (type === 'click_xy' || (type === 'click' && action.x != null && action.y != null && !action.selector)) {
    const x = Number(action.x);
    const y = Number(action.y);
    const clicks = Number(action.clicks) || 1;
    const button = action.button || 'left';
    await session.page.mouse.click(x, y, { clickCount: clicks, button });
    return { ok: true, summary: `Clicked at (${x}, ${y}) [${button}, ${clicks}x]` };
  }

  // Selector-based click (original)
  if (type === 'click' && action.selector) {
    await session.page.locator(action.selector).first().click({ timeout: 15000 });
    return { ok: true, summary: `Clicked ${action.selector}` };
  }

  // Agent-S style: grounded click by description
  if (type === 'click_element') {
    const obs = await captureObservation({ sessionId, workingDirectory: '/tmp' });
    const coords = await groundElement({
      screenshot: obs.screenshotBase64,
      description: action.description || action.selector || ''
    });
    if (coords.confidence > 0.3) {
      await session.page.mouse.click(coords.x, coords.y, { clickCount: 1 });
      return { ok: true, summary: `Grounded click on "${action.description}" at (${coords.x}, ${coords.y}) [${coords.method}]` };
    }
    return { ok: false, summary: `Could not ground element "${action.description}" (confidence: ${coords.confidence})` };
  }

  // Type with optional coordinate click first
  if (type === 'type') {
    if (action.x != null && action.y != null) {
      await session.page.mouse.click(Number(action.x), Number(action.y));
      await session.page.waitForTimeout(200);
    } else if (action.selector) {
      await session.page.locator(action.selector).first().click({ timeout: 15000 });
      await session.page.waitForTimeout(200);
    }
    if (action.overwrite) {
      await session.page.keyboard.press('Meta+a');
      await session.page.keyboard.press('Backspace');
    }
    await session.page.keyboard.type(String(action.text || ''), { delay: 30 });
    if (action.enter) {
      await session.page.keyboard.press('Enter');
    }
    return { ok: true, summary: `Typed "${String(action.text || '').slice(0, 50)}"` };
  }

  if (type === 'press') {
    await session.page.keyboard.press(String(action.key || 'Enter'));
    return { ok: true, summary: `Pressed ${action.key}` };
  }

  if (type === 'hotkey') {
    const keys = Array.isArray(action.keys) ? action.keys : String(action.keys || '').split('+');
    const combo = keys.join('+');
    await session.page.keyboard.press(combo);
    return { ok: true, summary: `Hotkey ${combo}` };
  }

  if (type === 'scroll') {
    const x = Number.isFinite(Number(action.x)) ? Number(action.x) : 0;
    const y = Number.isFinite(Number(action.y)) ? Number(action.y) : 600;
    if (action.target_x != null && action.target_y != null) {
      await session.page.mouse.move(Number(action.target_x), Number(action.target_y));
    }
    await session.page.mouse.wheel(x, y);
    return { ok: true, summary: `Scrolled by (${x}, ${y})` };
  }

  if (type === 'wait') {
    const ms = Math.min(Number(action.ms) || 1000, 10000);
    await session.page.waitForTimeout(ms);
    return { ok: true, summary: `Waited ${ms}ms` };
  }

  if (type === 'navigate') {
    await session.page.goto(String(action.url), { waitUntil: 'domcontentloaded', timeout: 30000 });
    return { ok: true, summary: `Navigated to ${action.url}` };
  }

  if (type === 'done') {
    return { ok: true, summary: 'Task marked as complete', done: true };
  }

  return { ok: false, summary: `Unknown GUI action: ${type}` };
}

module.exports = {
  captureObservation,
  executeGuiAction
};
