import { describe, it, expect } from 'vitest';
import { linkifyUrls } from './linkifyUrls';

describe('linkifyUrls', () => {
  it('converts bare http URL to markdown link', () => {
    const result = linkifyUrls('Visit http://example.com for info');
    expect(result).toBe('Visit [http://example.com](http://example.com) for info');
  });

  it('converts bare https URL to markdown link', () => {
    const result = linkifyUrls('Check https://google.com/search?q=test');
    expect(result).toBe('Check [https://google.com/search?q=test](https://google.com/search?q=test)');
  });

  it('does not double-linkify already linked URLs', () => {
    const input = '[click here](https://example.com)';
    const result = linkifyUrls(input);
    expect(result).toBe(input);
  });

  it('does not linkify URLs inside inline code', () => {
    const input = 'Use `https://example.com` as the endpoint';
    const result = linkifyUrls(input);
    expect(result).toBe(input);
  });

  it('does not linkify URLs inside code blocks', () => {
    const input = '```\nhttps://example.com\n```';
    const result = linkifyUrls(input);
    expect(result).toBe(input);
  });

  it('handles multiple URLs in one line', () => {
    const result = linkifyUrls('See https://a.com and https://b.com');
    expect(result).toBe('See [https://a.com](https://a.com) and [https://b.com](https://b.com)');
  });

  it('strips trailing period', () => {
    const result = linkifyUrls('Visit https://example.com.');
    expect(result).toBe('Visit [https://example.com](https://example.com).');
  });

  it('strips trailing parenthesis', () => {
    const result = linkifyUrls('See (https://example.com)');
    expect(result).toBe('See ([https://example.com](https://example.com))');
  });

  it('handles URL at end of line', () => {
    const result = linkifyUrls('Link: https://example.com');
    expect(result).toBe('Link: [https://example.com](https://example.com)');
  });

  it('returns empty string for empty input', () => {
    expect(linkifyUrls('')).toBe('');
  });

  it('returns non-string input as-is', () => {
    expect(linkifyUrls(null as any)).toBe(null);
    expect(linkifyUrls(undefined as any)).toBe(undefined);
  });

  it('does not linkify non-URL text', () => {
    const input = 'Hello world, this is plain text.';
    expect(linkifyUrls(input)).toBe(input);
  });
});
