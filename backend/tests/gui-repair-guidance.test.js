import { describe, it, expect } from 'vitest';

const { appendGuiRepairGuidance, buildGuiRepairGuidance } = require('../gui/repairGuidance');

describe('GUI repair guidance', () => {
  it('adds chrome_missing repair steps', () => {
    const message = 'Browser open error: No installed Chrome found for CDP mode\nCode: chrome_missing';
    const output = appendGuiRepairGuidance(message);
    expect(output).toContain('Düzəltmə addımı:');
    expect(output).toContain('start-debug-chrome.sh');
    expect(output).toContain('bundled');
  });

  it('adds screen agent guidance for missing python', () => {
    const message = 'Screen screenshot error: spawn /app/.venv/bin/python3 ENOENT';
    const output = buildGuiRepairGuidance(message);
    expect(output).toContain('.venv');
    expect(output).toContain('gui');
  });
});
