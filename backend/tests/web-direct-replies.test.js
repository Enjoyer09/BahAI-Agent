import { describe, it, expect, vi, afterEach } from 'vitest';
import chatRouter from '../routes/chat.js';
import { buildDialogueContinuityHint } from '../helpers.js';

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

  it('resolves deqiqleshdir follow-up against the previous assistant offer', async () => {
    const reply = await getDirectWebChatReply('deqiqleshdir', [
      { role: 'user', content: 'HP 250 G10' },
      { role: 'assistant', content: 'Bud, HP 250 G10. Tam spesifikasiya və ya Azərbaycandakı cari qiyməti maraqlanırsansa, birbaşa soruş, dəqiqləşdirim.' },
    ]);
    expect(reply).toContain('HP 250 G10');
    expect(reply).toContain('tam spesifikasiya');
    expect(reply).toContain('qiymət');
  });

  it('uses previous weather answer for contextual follow-up advice', async () => {
    const reply = await getDirectWebChatReply('bu havada ne etmek meslehet gorursen?', [
      { role: 'user', content: 'Bakida bugun hava necedir?' },
      { role: 'assistant', content: 'Bakıda hazırda light rain shower müşahidə olunur. Temperatur təxminən 22°C-dir. Külək 13 km/saat təşkil edir. Rütubət 91%-dir.' },
    ], {
      previousUser: 'Bakida bugun hava necedir?',
      previousAssistant: 'Bakıda hazırda light rain shower müşahidə olunur. Temperatur təxminən 22°C-dir. Külək 13 km/saat təşkil edir. Rütubət 91%-dir.'
    });

    expect(reply).toContain('çətir');
    expect(reply).toContain('qapalı məkanda');
  });

  it('keeps prior product thread on short confirmation follow-up', async () => {
    const reply = await getDirectWebChatReply('bəli', [
      { role: 'user', content: 'HP 250 G10' },
      { role: 'assistant', content: 'HP 250 G10 üçün tam spesifikasiya və ya Azərbaycandakı cari qiyməti dəqiqləşdirə bilərəm. İstəsən davam edək.' },
    ]);

    expect(reply).toContain('HP 250 G10');
    expect(reply).toContain('tam spesifikasiya');
  });

  it('binds previous user to the latest assistant instead of the latest short user follow-up', async () => {
    const reply = await getDirectWebChatReply('deqiqleshdir', [
      { role: 'user', content: 'Bes 120 laptop TecPro DC shirketinnen bu il mayda alinib.' },
      { role: 'assistant', content: 'Anladım. 120 laptop barədə qeyd etdiniz. Hansı modeldir?' },
      { role: 'user', content: 'HP 250 G10' },
      { role: 'assistant', content: 'Bud, HP 250 G10. Tam spesifikasiya və ya Azərbaycandakı cari qiyməti maraqlanırsansa, birbaşa soruş, dəqiqləşdirim.' },
    ]);

    expect(reply).toContain('HP 250 G10');
    expect(reply).not.toContain('120 laptop');
  });
});

describe('dialogue continuity hint', () => {
  it('builds continuation hint for short same-thread follow-up', () => {
    const result = buildDialogueContinuityHint([
      { role: 'user', content: 'HP 250 G10' },
      { role: 'assistant', content: 'HP 250 G10 üçün tam spesifikasiya və ya qiyməti dəqiqləşdirə bilərəm.' },
    ], 'bəli');

    expect(result.continuityHint).toBeTruthy();
    expect(result.continuityHint.previousUser).toContain('HP 250 G10');
  });

  it('does not force continuity when user clearly starts a fresh topic', () => {
    const result = buildDialogueContinuityHint([
      { role: 'user', content: 'HP 250 G10' },
      { role: 'assistant', content: 'HP 250 G10 üçün tam spesifikasiya və ya qiyməti dəqiqləşdirə bilərəm.' },
    ], 'Bakıda hava necədir?');

    expect(result.continuityHint).toBeNull();
  });
});
