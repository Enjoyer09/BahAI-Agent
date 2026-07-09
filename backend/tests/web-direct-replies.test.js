import { describe, it, expect, vi, afterEach } from 'vitest';
import chatRouter from '../routes/chat.js';

const { getDirectWebChatReply } = chatRouter;

describe('web direct replies', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns current date reply for Azerbaijani date question', async () => {
    const reply = await getDirectWebChatReply('Bugün ayın neçəsidir?', []);
    expect(reply).toMatch(/^Bu gün /);
    expect(reply).toContain('2026');
  });

  it('handles inflected Azerbaijani weather city names', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => 'Sunny|+29°C|11 km/h|43%'
    }));

    const reply = await getDirectWebChatReply('Sumqayıtda hava necədir?', []);
    expect(reply).toContain('Sumqayıtda');
    expect(reply).toContain('29°C');
    expect(reply).toContain('11 km/saat');
    expect(reply).toContain('43%');
  });

  it('asks for clarification for generic world championship queries outside canned date branch', async () => {
    const reply = await getDirectWebChatReply('Bugün FIFA Dünya Çempionatında hansı oyunlar var?', []);
    expect(reply).toContain('Hansı turniri nəzərdə tutduğunuzu');
    expect(reply).toContain('FIFA Dünya Kuboku');
  });
});
