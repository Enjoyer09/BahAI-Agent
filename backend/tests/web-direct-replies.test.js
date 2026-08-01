import { describe, it, expect, vi, afterEach } from 'vitest';
import chatRouter from '../routes/chat.js';
import { buildDialogueContinuityHint } from '../helpers.js';

const { getDirectWebChatReply } = chatRouter;

describe('web direct replies', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('answers Azerbaijani greeting locally without calling a provider', async () => {
    const reply = await getDirectWebChatReply('hervaxtin xeyr olsun... necesen?', []);
    expect(reply).toContain('Hər vaxtın xeyir');
    expect(reply).toContain('Sən necəsən');
  });

  it('answers presence checks locally without calling a provider', async () => {
    const reply = await getDirectWebChatReply('burdasan?', []);
    expect(reply).toContain('Bəli, buradayam');
  });

  it('returns current date reply for Azerbaijani date question', async () => {
    const reply = await getDirectWebChatReply('Bugün ayın neçəsidir?', []);
    expect(reply).toMatch(/^Bu gün /);
    expect(reply).toContain('2026');
  });

  it('calculates quantity, unit price and VAT locally without a provider', async () => {
    const reply = await getDirectWebChatReply(
      '120 ədəd laptopun hər biri 850 AZN-dirsə, ümumi məbləği və 18% ƏDV-ni hesabla.',
      []
    );

    expect(reply).toContain('102,000 AZN');
    expect(reply).toContain('18,360 AZN');
    expect(reply).toContain('120,360 AZN');
  });

  it('calculates a simple percentage locally without a provider', async () => {
    const reply = await getDirectWebChatReply(
      '20-nin 15 faizi neçədir? Yalnız rəqəmi yaz.',
      []
    );

    expect(reply).toBe('3');
  });

  it('rejects a known false named-entity premise instead of attaching a generic search result', async () => {
    const reply = await getDirectWebChatReply(
      'Bakı metrosunun Ay stansiyasına gediş haqqı neçədir?',
      []
    );

    expect(reply).toContain('“Ay” adlı stansiya yoxdur');
    expect(reply).not.toContain('60 qəpik');
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

  it('passes generic world championship queries to LLM and search', async () => {
    const reply = await getDirectWebChatReply('Bugün FIFA Dünya Çempionatında hansı oyunlar var?', []);
    expect(reply).toBe('');
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

  it('does not lose a previously recognized document referent in follow-up warranty question', async () => {
    const reply = await getDirectWebChatReply('bu sened mehsullarin qarantiyada oldugunu tesdiqleyir?', [
      {
        role: 'user',
        content: 'bu sekil ne senedidir?',
        attachments: [{ id: 'a1', name: 'techpro-doc.jpg', type: 'image', mimeType: 'image/jpeg', extractedText: 'DISTRIBUTERIN ETIBARNAMESININ FORMASI' }],
      },
      {
        role: 'assistant',
        content: 'Bu şəkil distributerin etibarnaməsinin forması sənədidir. Techpro DC LTD tərəfindən verilən səlahiyyət məktubudur.'
      },
    ], {
      previousUser: 'bu sekil ne senedidir?',
      previousAssistant: 'Bu şəkil distributerin etibarnaməsinin forması sənədidir. Techpro DC LTD tərəfindən verilən səlahiyyət məktubudur.',
      previousAttachment: { name: 'techpro-doc.jpg', type: 'image', mimeType: 'image/jpeg', extractedText: 'DISTRIBUTERIN ETIBARNAMESININ FORMASI' }
    });

    expect(reply).toContain('birbaşa məhsulların qarantiyada olduğunu təsdiqləmir');
    expect(reply).not.toContain('sənədi görmürəm');
    expect(reply).not.toContain('yenidən paylaş');
  });

  it('does not pretend there was a previous attachment in a fresh chat', async () => {
    const reply = await getDirectWebChatReply('bu sekil nedir?', [
      {
        role: 'user',
        content: 'bu sekil nedir?',
        attachments: [{ id: 'a1', name: 'doc.jpg', type: 'image', mimeType: 'image/jpeg', extractedText: 'DISTRIBUTERIN ETIBARNAMESININ FORMASI' }],
      },
    ], {
      previousUser: 'old message',
      previousAssistant: 'old assistant',
      previousAttachment: { name: 'old.jpg', type: 'image', mimeType: 'image/jpeg', extractedText: 'OLD' }
    });

    expect(reply).not.toContain('əvvəlki attachment');
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
