/**
 * Auto-linkify bare URLs in markdown text.
 *
 * Converts raw http(s) URLs that are NOT already inside markdown link syntax
 * `[text](url)` or code spans ```...``` into clickable `[url](url)` format.
 *
 * This runs BEFORE react-markdown parses the content, so the resulting
 * markdown links are rendered by the existing `a` component with
 * target="_blank" + rel="noopener noreferrer".
 */

// Matches http/https URLs, stopping at common trailing punctuation.
// Avoids matching inside already-linked markdown or code spans.
const URL_REGEX = /(https?:\/\/[^\s<>'")\]]+?)(?=[.,;:!?\)]*(?:\s|$|\)|\]|`))/gi;

// Characters to strip from the end of a detected URL (trailing punctuation
// that is almost never part of the actual URL).
const TRAILING_STRIP = /[.,;:!?\)]+$/;

// Characters to strip from the start (rare, but handles leading parens).
const LEADING_STRIP = /^[(\[]+/;

export function linkifyUrls(text: string): string {
  if (!text || typeof text !== 'string') return text;

  // Split by code blocks, inline code, AND markdown links to avoid
  // double-linkifying URLs that are already wrapped.
  const parts = text.split(/(```[\s\S]*?```|`[^`\n]+`|\[[^\]]*\]\([^)]+\))/g);
  return parts
    .map((part, i) => {
      // Odd indices are code blocks, code spans, or existing markdown links
      if (i % 2 !== 0) return part;

      return part.replace(URL_REGEX, (match) => {
        let url = match.replace(LEADING_STRIP, '').replace(TRAILING_STRIP, '');
        if (url.length < 8) return match;
        return `[${url}](${url})`;
      });
    })
    .join('');
}
