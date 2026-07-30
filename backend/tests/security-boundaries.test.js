import { afterEach, describe, expect, it } from 'vitest';
import helpers from '../helpers.js';
import { validateProviderBaseUrl } from '../chat/providers.js';

const originalLocalMode = process.env.LOCAL_MODE;
const originalMaxAttachmentBytes = process.env.MAX_ATTACHMENT_BYTES;

afterEach(() => {
  if (originalLocalMode === undefined) delete process.env.LOCAL_MODE;
  else process.env.LOCAL_MODE = originalLocalMode;
  if (originalMaxAttachmentBytes === undefined) delete process.env.MAX_ATTACHMENT_BYTES;
  else process.env.MAX_ATTACHMENT_BYTES = originalMaxAttachmentBytes;
});

describe('workspace boundaries', () => {
  it('rejects an attacker-controlled absolute working directory outside allowed roots', () => {
    process.env.LOCAL_MODE = 'false';
    helpers.setAllowedDirs('/tmp/bahai-safe', ['/tmp/bahai-safe']);

    expect(helpers.isPathSafe('/etc/passwd', '/etc', { id: 7 })).toBe(false);
    expect(helpers.isPathSafe('/tmp/bahai-safe/project/file.txt', '/tmp/bahai-safe/project', { id: 7 })).toBe(true);
  });
});

describe('provider URL validation', () => {
  it('blocks private and non-HTTP provider destinations in cloud mode', async () => {
    await expect(validateProviderBaseUrl('https://127.0.0.1:8080/v1')).rejects.toThrow(/Private|lokal/i);
    await expect(validateProviderBaseUrl('file:///etc/passwd')).rejects.toThrow(/HTTP/i);
  });

  it('allows loopback providers only when private access is explicitly enabled', async () => {
    await expect(
      validateProviderBaseUrl('http://127.0.0.1:11434/v1', { allowPrivate: true })
    ).resolves.toBe('http://127.0.0.1:11434/v1');
  });
});

describe('attachment limits', () => {
  it('rejects oversized data URLs before decoding them', async () => {
    process.env.MAX_ATTACHMENT_BYTES = '8';
    await expect(helpers.extractAttachment({
      name: 'large.txt',
      mimeType: 'text/plain',
      url: `data:text/plain;base64,${Buffer.from('too large payload').toString('base64')}`
    })).rejects.toThrow(/limitini keçir/i);
  });
});
