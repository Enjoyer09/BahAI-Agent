import { describe, it, expect } from 'vitest';

const { normalizeComputerUseAction, isRiskyComputerUseAction } = require('../gui/computerUseActions');

describe('computer use actions', () => {
  it('normalizes numeric and string fields', () => {
    const action = normalizeComputerUseAction({
      type: 'click',
      x: '120',
      y: '240',
      clicks: '2',
      button: 'left'
    });

    expect(action.type).toBe('click');
    expect(action.x).toBe(120);
    expect(action.y).toBe(240);
    expect(action.clicks).toBe(2);
  });

  it('marks current primitive set as non-risky by default', () => {
    expect(isRiskyComputerUseAction({ type: 'open_app', app: 'Finder' })).toBe(false);
    expect(isRiskyComputerUseAction({ type: 'click', x: 1, y: 1 })).toBe(false);
  });
});
