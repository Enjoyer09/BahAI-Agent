import { describe, it, expect } from 'vitest';
import path from 'node:path';
import {
  filterFile,
  processImageFile,
  processFileUpload,
  processDeleteRequest,
  createStorageStrategy,
  resizeImageDataUrl,
  decodeDataUrl,
  encodeDataUrl,
  sanitizeFilename,
  MemoryStorage,
  LocalStorage,
} from '../chat/attachmentPipeline.js';

// 1x1 transparent PNG
const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const TINY_PNG_DATA_URL = `data:image/png;base64,${TINY_PNG_BASE64}`;

describe('attachmentPipeline', () => {
  describe('filterFile', () => {
    it('accepts supported images', () => {
      const result = filterFile({ mimetype: 'image/png', size: 1024 });
      expect(result.isImage).toBe(true);
    });

    it('rejects oversized files', () => {
      expect(() => filterFile({ mimetype: 'image/png', size: 21 * 1024 * 1024 }))
        .toThrow(/20MB/);
    });

    it('marks non-images as documents', () => {
      const result = filterFile({ mimetype: 'application/pdf', size: 100 });
      expect(result.isImage).toBe(false);
      expect(result.mimeType).toBe('application/pdf');
    });
  });

  describe('decode/encode data URLs', () => {
    it('decodes base64 data URLs', () => {
      const decoded = decodeDataUrl(TINY_PNG_DATA_URL);
      expect(decoded.mimeType).toBe('image/png');
      expect(decoded.buffer.length).toBeGreaterThan(0);
    });

    it('round-trips encode -> decode', () => {
      const decoded = decodeDataUrl(TINY_PNG_DATA_URL);
      const encoded = encodeDataUrl(decoded.buffer, 'image/png');
      expect(encoded.startsWith('data:image/png;base64,')).toBe(true);
      expect(decodeDataUrl(encoded).buffer.equals(decoded.buffer)).toBe(true);
    });
  });

  describe('sanitizeFilename', () => {
    it('strips unsafe characters and paths', () => {
      expect(sanitizeFilename('../../etc/passwd.png')).toBe('passwd.png');
      expect(sanitizeFilename('my file (1).png')).toMatch(/\.png$/);
    });
  });

  describe('processImageFile', () => {
    it('processes a PNG data URL and returns metadata + dataUrl', async () => {
      const result = await processImageFile({
        name: 'logo.png',
        mimetype: 'image/png',
        url: TINY_PNG_DATA_URL,
        size: 68,
      });
      expect(result.filename).toMatch(/\.png$/);
      expect(result.mimeType).toBe('image/png');
      expect(result.url).toMatch(/^data:image\//);
      expect(result.buffer.length).toBeGreaterThan(0);
    });

    it('rejects non-image files', async () => {
      await expect(processImageFile({ name: 'doc.pdf', mimetype: 'application/pdf', buffer: Buffer.from('x') }))
        .rejects.toThrow(/not a supported image/);
    });

    it('throws when the file has no readable content', async () => {
      await expect(processImageFile({ name: 'a.png', mimetype: 'image/png' }))
        .rejects.toThrow(/no readable content/);
    });
  });

  describe('storage strategies', () => {
    it('memory storage saves, reads, deletes', async () => {
      const store = new MemoryStorage();
      const saved = await store.save('f1', Buffer.from('hello'), { originalName: 'x.txt' });
      expect(saved.size).toBe(5);
      const read = await store.read('f1');
      expect(read.buffer.toString()).toBe('hello');
      expect(read.meta.originalName).toBe('x.txt');
      expect(await store.delete('f1')).toBe(true);
      expect(await store.read('f1')).toBeNull();
    });

    it('local storage writes to disk and removes files', async () => {
      const store = new LocalStorage({ dir: '/tmp/bahai-pipeline-test' });
      const saved = await store.save('f-local', Buffer.from('data'));
      expect(saved.filePath).toContain('f-local');
      const read = await store.read('f-local');
      expect(read.buffer.toString()).toBe('data');
      expect(await store.delete('f-local')).toBe(true);
      expect(await store.read('f-local')).toBeNull();
    });

    it('local storage blocks path traversal in ids', async () => {
      const store = new LocalStorage({ dir: '/tmp/bahai-pipeline-traversal-test' });
      const saved = await store.save('../../etc/evil', Buffer.from('x'));
      // basename() keeps the file inside the configured dir
      expect(path.basename(saved.filePath)).toBe('evil');
      expect(saved.filePath).not.toContain('/etc/');
      // deleting it cannot touch anything outside the dir
      const deleted = await store.delete('../../etc/evil');
      expect(deleted).toBe(true);
      expect(await store.read('../../etc/evil')).toBeNull();
    });

    it('createStorageStrategy resolves memory and local', () => {
      expect(createStorageStrategy('memory')).toBeInstanceOf(MemoryStorage);
      expect(createStorageStrategy('local', { dir: '/tmp/x' })).toBeInstanceOf(LocalStorage);
    });
  });

  describe('processFileUpload', () => {
    it('dispatches images to the image path', async () => {
      const result = await processFileUpload({
        name: 'img.png',
        mimetype: 'image/png',
        url: TINY_PNG_DATA_URL,
        size: 68,
      });
      expect(result.type).toBe('image');
      expect(result.url).toMatch(/^data:image\//);
    });

    it('passes documents through with content', async () => {
      const result = await processFileUpload({
        name: 'notes.txt',
        mimetype: 'text/plain',
        buffer: Buffer.from('hello world'),
        size: 11,
      });
      expect(result.type).toBe('document');
      expect(result.buffer.toString()).toBe('hello world');
    });

    it('stores via strategy when requested', async () => {
      const result = await processFileUpload({
        name: 'img.png',
        mimetype: 'image/png',
        url: TINY_PNG_DATA_URL,
        size: 68,
      }, { storage: 'memory' });
      expect(result.storage.id).toBeTruthy();
      expect(result.storage.size).toBeGreaterThan(0);
    });
  });

  describe('processDeleteRequest', () => {
    it('deletes from memory storage', async () => {
      const store = new MemoryStorage();
      await store.save('gone', Buffer.from('x'));
      const result = await processDeleteRequest('gone', null, { storage: store });
      expect(result.success).toBe(true);
    });

    it('reports missing files gracefully', async () => {
      const result = await processDeleteRequest('nope', '/tmp/does-not-exist-xyz');
      expect(result.success).toBe(false);
    });
  });

  describe('resizeImageDataUrl', () => {
    it('returns the original URL when sharp is unavailable or decode fails', async () => {
      const result = await resizeImageDataUrl(TINY_PNG_DATA_URL);
      expect(result.startsWith('data:image/')).toBe(true);
    });

    it('returns non-data URLs unchanged', async () => {
      expect(await resizeImageDataUrl('https://example.com/a.png')).toBe('https://example.com/a.png');
    });

    it('downscales a large image with sharp when available (positive path)', async () => {
      let sharp = null;
      try { sharp = require('sharp'); } catch { /* optional */ }
      if (!sharp) return; // skip gracefully when sharp is not installed

      const big = await sharp({
        create: {
          width: 3200, height: 2400, channels: 3,
          background: { r: 200, g: 100, b: 50 },
        },
      }).png().toBuffer();
      const bigDataUrl = encodeDataUrl(big, 'image/png');

      const resized = await resizeImageDataUrl(bigDataUrl, { maxDimension: 800 });
      const decoded = decodeDataUrl(resized);
      expect(decoded).toBeTruthy();
      // A 3200px image resized to <=800px must shrink meaningfully
      expect(decoded.buffer.length).toBeLessThan(big.length);
    });
  });
});
