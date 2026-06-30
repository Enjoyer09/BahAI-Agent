import { describe, it, expect } from 'vitest';

const { isCdpContextManagementError } = require('../browserSession');

describe('browserSession helpers', () => {
  it('detects unsupported CDP context management errors', () => {
    expect(
      isCdpContextManagementError(
        new Error('browserType.connectOverCDP: Protocol error (Browser.setDownloadBehavior): Browser context management is not supported.')
      )
    ).toBe(true);
  });

  it('does not classify unrelated CDP errors as context-management failures', () => {
    expect(
      isCdpContextManagementError(
        new Error('connect ECONNREFUSED 127.0.0.1:9222')
      )
    ).toBe(false);
  });
});
