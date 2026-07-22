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

  it('verifies getToolsForProfile returns correct read-only tools for web-chat', () => {
    const { getToolsForProfile } = require('../tools/profiles');
    const tools = getToolsForProfile('web-chat');
    const toolNames = tools.map(t => t.function.name);
    
    expect(toolNames).toContain('read_file');
    expect(toolNames).toContain('web_search');
    expect(toolNames).not.toContain('write_file');
    expect(toolNames).not.toContain('run_terminal_command');
  });
});
