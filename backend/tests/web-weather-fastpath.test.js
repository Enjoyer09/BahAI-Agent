import { describe, it, expect, vi, afterEach } from 'vitest';
import * as chat from '../routes/chat.js';

// Exercises the web weather fast-path that short-circuits the 3-step agent loop.
// `fetch` is mocked so the test is deterministic and network-independent.
describe('web weather fast-path', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns current weather directly from wttr.in for a simple city query', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      text: async () => 'Light rain shower|+22°C|↑7 km/h|85%'
    });
    const reply = await chat.getDirectWebChatReply('Bakıda indi hava necədir?', []);
    expect(typeof reply).toBe('string');
    expect(reply.length).toBeGreaterThan(0);
    expect(reply).toMatch(/Bakıda hazırda/i);
    expect(reply).toMatch(/22°C/i);
  });

  it('falls through (empty) for multi-day forecast questions', async () => {
    const reply = await chat.getDirectWebChatReply('Bakıda 3 günlük hava proqnozu nədir?', []);
    expect(reply).toBe('');
  });

  it('falls through (empty) for weather without a known city', async () => {
    const reply = await chat.getDirectWebChatReply('Hava necədir?', []);
    expect(reply).toBe('');
  });

  it('falls through (empty) when wttr.in is unreachable', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('network down'));
    const reply = await chat.getDirectWebChatReply('Sumqayıtda indi hava necədir?', []);
    expect(reply).toBe('');
  });
});
