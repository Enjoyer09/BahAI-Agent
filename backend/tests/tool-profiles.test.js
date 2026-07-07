import { describe, it, expect } from 'vitest';
import { getToolsForRole, getToolProfile } from '../tools/profiles.js';

describe('tool profiles', () => {
  it('web-chat profile excludes mutating/code-agent tools for solo role', () => {
    const tools = getToolsForRole('Solo Agent', 'web-chat').map((tool) => tool.function.name);

    expect(tools).toContain('web_search');
    expect(tools).toContain('read_file');
    expect(tools).not.toContain('write_file');
    expect(tools).not.toContain('file_edit');
    expect(tools).not.toContain('run_terminal_command');
    expect(tools).not.toContain('start_server');
    expect(tools).not.toContain('gui_step');
    expect(tools).not.toContain('computer_use_step');
  });

  it('desktop-local profile still exposes full local coding surface', () => {
    const tools = getToolsForRole('Solo Agent', 'desktop-local').map((tool) => tool.function.name);

    expect(tools).toContain('write_file');
    expect(tools).toContain('run_terminal_command');
    expect(tools).toContain('gui_step');
  });

  it('web-chat profile remains read-only', () => {
    const profile = getToolProfile('web-chat');
    expect(profile).toContain('read_file');
    expect(profile).not.toContain('write_file');
    expect(profile).not.toContain('run_terminal_command');
  });
});
