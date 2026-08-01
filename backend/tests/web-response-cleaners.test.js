import { describe, it, expect } from 'vitest';
import { cleanWebAssistantResponse } from '../chat/webRagCleaner.js';
import { verifyAndCleanAssistantResponse } from '../chat/verifierGuardrail.js';

describe('web response cleaners', () => {
  it('removes standalone raw tool-call JSON from a web answer', () => {
    const text = JSON.stringify({
      name: 'web_search',
      arguments: { query: 'XəzərOS 12 minimum requirements' }
    }, null, 2);

    expect(cleanWebAssistantResponse(text, true)).toBe('');
  });

  it('removes unsupported synthetic citation markers', () => {
    expect(cleanWebAssistantResponse('Qiymət 0,60 AZN-dir【0†L1-L4】.', true))
      .toBe('Qiymət 0,60 AZN-dir.');
  });

  it('normalizes common Turkish leakage in Azerbaijani web replies', () => {
    const cleaned = verifyAndCleanAssistantResponse(
      'Hayır, fotosintez yaprağında gerçekleşir.',
      true
    );

    expect(cleaned).toContain('Xeyr');
    expect(cleaned).toContain('yarpağında');
    expect(cleaned).toContain('baş verir');
  });
});
