import { describe, expect, it } from 'vitest';

const helpers = require('../helpers');

describe('web product guard', () => {
  it('strips desktop-only wording from web chat assistant text', () => {
    const result = helpers.normalizeFinalAssistantReport(
      'Google login keçdi. İndi open electron edin və bahai://auth/callback?token=abc yoluna baxın.',
      { productMode: 'web_chat' }
    );

    expect(result).not.toMatch(/open electron/i);
    expect(result).not.toMatch(/bahai:\/\//i);
    expect(result).toMatch(/desktop tətbiqi|Google login keçdi/i);
  });

  it('keeps desktop wording in desktop product mode', () => {
    const text = 'Google login keçdi. İndi open electron edin və bahai://auth/callback?token=abc yoluna baxın.';
    const result = helpers.normalizeFinalAssistantReport(text, { productMode: 'desktop_code' });
    expect(result).toContain('open electron');
    expect(result).toContain('bahai://auth/callback');
  });
});
