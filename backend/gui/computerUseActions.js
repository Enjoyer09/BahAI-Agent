const {
  takeScreenshot,
  mouseClick,
  typeText,
  pressKey,
  scroll,
  openUrl,
  openApp
} = require('./screen-agent');
const fs = require('fs/promises');

function normalizeComputerUseAction(action = {}) {
  const type = String(action.type || '').trim().toLowerCase();
  return {
    type,
    x: Number.isFinite(Number(action.x)) ? Number(action.x) : undefined,
    y: Number.isFinite(Number(action.y)) ? Number(action.y) : undefined,
    clicks: Number.isFinite(Number(action.clicks)) ? Number(action.clicks) : undefined,
    button: action.button ? String(action.button) : undefined,
    text: action.text != null ? String(action.text) : undefined,
    key: action.key ? String(action.key) : undefined,
    amount: Number.isFinite(Number(action.amount)) ? Number(action.amount) : undefined,
    url: action.url ? String(action.url) : undefined,
    app: action.app ? String(action.app) : undefined
  };
}

function isRiskyComputerUseAction(action = {}) {
  const type = String(action.type || '').trim().toLowerCase();
  if (type === 'open_url' || type === 'open_app' || type === 'screenshot' || type === 'scroll') {
    return false;
  }
  return false;
}

async function executeComputerUseAction(action = {}) {
  const normalized = normalizeComputerUseAction(action);

  switch (normalized.type) {
    case 'screenshot': {
      const shot = await takeScreenshot();
      return { ok: true, action: normalized, screenshotPath: shot.path };
    }
    case 'click': {
      const result = await mouseClick(normalized.x, normalized.y, {
        clicks: normalized.clicks || 1,
        button: normalized.button || 'left'
      });
      return { ok: true, action: normalized, result };
    }
    case 'type': {
      const result = await typeText(normalized.text || '', { useClipboard: /[^\x00-\x7F]/.test(normalized.text || '') });
      return { ok: true, action: normalized, result };
    }
    case 'press': {
      const result = await pressKey(normalized.key || 'enter');
      return { ok: true, action: normalized, result };
    }
    case 'scroll': {
      const result = await scroll(normalized.amount || -3, { x: normalized.x, y: normalized.y });
      return { ok: true, action: normalized, result };
    }
    case 'open_url': {
      const result = await openUrl(normalized.url || '');
      return { ok: true, action: normalized, result };
    }
    case 'open_app': {
      const result = await openApp(normalized.app || 'Finder');
      return { ok: true, action: normalized, result };
    }
    default:
      throw new Error(`Unknown computer use action: ${normalized.type}`);
  }
}

async function observeComputerUseState() {
  const shot = await takeScreenshot();
  let screenshotBase64 = '';
  try {
    const buffer = await fs.readFile(shot.path);
    screenshotBase64 = buffer.toString('base64');
  } catch {
    screenshotBase64 = '';
  }
  return {
    screenshotPath: shot.path,
    screenshotBase64,
    timestamp: shot.timestamp
  };
}

async function stepComputerUse({
  goal = '',
  action = null,
  history = []
} = {}) {
  const before = await observeComputerUseState();
  const normalizedAction = action ? normalizeComputerUseAction(action) : { type: 'screenshot' };
  const result = await executeComputerUseAction(normalizedAction);
  const after = await observeComputerUseState();

  return {
    observation: after,
    before,
    action: normalizedAction,
    assessment: {
      executable: true,
      action: normalizedAction,
      reason: `Computer Use step executed for goal: ${String(goal || '').slice(0, 140)}`
    },
    result,
    reflection: {
      goal,
      success: true,
      action: normalizedAction,
      result,
      observation: after,
      nextRecommendation: 'Inspect the updated desktop screenshot and decide the next precise action.'
    },
    history: [...history, { action: normalizedAction, result, observation: after }].slice(-8)
  };
}

module.exports = {
  normalizeComputerUseAction,
  isRiskyComputerUseAction,
  executeComputerUseAction,
  observeComputerUseState,
  stepComputerUse
};
