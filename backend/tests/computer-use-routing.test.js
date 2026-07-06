import { describe, it, expect } from 'vitest';

const {
  isComputerUseOpenRequest,
  isComputerUseContinuationRequest,
  extractComputerUseTarget
} = require('../gui/computerUseRequests');

describe('computer use request routing', () => {
  it('detects open requests for desktop workflow', () => {
    expect(
      isComputerUseOpenRequest('Computer Use ile Finder ac. Workflow: computer_use.', 'computer_use')
    ).toBe(true);
  });

  it('detects continuation requests for desktop workflow', () => {
    expect(
      isComputerUseContinuationRequest('indi search box-a yaz ve enter bas', 'computer_use')
    ).toBe(true);
  });

  it('extracts url target when present', () => {
    const target = extractComputerUseTarget('Computer Use ile https://example.com ac');
    expect(target.type).toBe('url');
    expect(target.value).toBe('https://example.com');
  });

  it('falls back to app target', () => {
    const target = extractComputerUseTarget('Computer Use ile Finder ac');
    expect(target.type).toBe('app');
    expect(target.value).toBe('Finder');
  });
});
