// Vitest unit tests for the most fragile parsing logic in the backend.
// Run with: cd backend && npx vitest run
// These tests do NOT require a running server, Ollama, or a database.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Load extractTextToolCalls + classifyTaskComplexity from the main module by
// reading the file and eval'ing the helpers in isolation. This avoids booting
// the Express app for unit tests.
const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');

function loadHelper(name) {
  const re = new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`, '');
  const m = SRC.match(re);
  if (!m) throw new Error(`Could not locate ${name} in index.js`);
  return m[0];
}

const ctx = { console };
// Minimal TOOLS stub (real list is large; tests only need the names we use)
ctx.TOOLS = [
  { function: { name: 'list_directory' } },
  { function: { name: 'read_file' } },
  { function: { name: 'grep_search' } },
  { function: { name: 'glob_search' } },
];

const sandbox = `${loadHelper('extractTextToolCalls')}\n${loadHelper('classifyTaskComplexity')}\nthis.extractTextToolCalls = extractTextToolCalls;\nthis.classifyTaskComplexity = classifyTaskComplexity;`;
// eslint-disable-next-line no-new-func
new Function('TOOLS', sandbox).call(ctx, ctx.TOOLS);

const { extractTextToolCalls, classifyTaskComplexity } = ctx;

describe('extractTextToolCalls', () => {
  it('parses a single fenced JSON tool call', () => {
    const r = extractTextToolCalls('```json\n{"name":"list_directory","arguments":{"path":"./"}}\n```');
    expect(r.toolCalls).toHaveLength(1);
    expect(r.toolCalls[0].name).toBe('list_directory');
  });

  it('parses a bare top-level JSON tool call', () => {
    const r = extractTextToolCalls('{"name":"read_file","arguments":{"path":"/foo"}}');
    expect(r.toolCalls).toHaveLength(1);
    expect(r.toolCalls[0].name).toBe('read_file');
  });

  it('keeps prose around the tool call', () => {
    const r = extractTextToolCalls('Salam! İndi oxuyacağam:\n```json\n{"name":"list_directory","arguments":{"path":"./"}}\n```\nNəticə.');
    expect(r.toolCalls).toHaveLength(1);
    expect(r.cleanedText).toContain('Salam');
    expect(r.cleanedText).toContain('Nəticə');
  });

  it('returns only the FIRST of multiple tool calls (prevents hallucination loops)', () => {
    const r = extractTextToolCalls('```json\n{"name":"list_directory","arguments":{"path":"./"}}\n```\n```json\n{"name":"read_file","arguments":{"path":"./x"}}\n```');
    expect(r.toolCalls).toHaveLength(1);
    expect(r.toolCalls[0].name).toBe('list_directory');
  });

  it('ignores unbalanced/invalid JSON', () => {
    const r = extractTextToolCalls('Code: { not valid');
    expect(r.toolCalls).toHaveLength(0);
  });

  it('handles escaped quotes inside arguments', () => {
    const r = extractTextToolCalls('{"name":"grep_search","arguments":{"query":"test\\"quoted","cwd":"./"}}');
    expect(r.toolCalls).toHaveLength(1);
    expect(JSON.parse(r.toolCalls[0].arguments).query).toBe('test"quoted');
  });

  it('returns no calls for plain prose', () => {
    const r = extractTextToolCalls('Just some text without any code blocks.');
    expect(r.toolCalls).toHaveLength(0);
  });

  it('handles mixed local-model output (prose + json keyword + JSON object)', () => {
    const r = extractTextToolCalls('bizim agent. json\n{"name":"list_directory","arguments":{"path":"/Users/x"}}\nİndi baxaq.');
    expect(r.toolCalls).toHaveLength(1);
    expect(JSON.parse(r.toolCalls[0].arguments).path).toBe('/Users/x');
  });
});

describe('classifyTaskComplexity (Auto router)', () => {
  it('treats short greetings as fast', () => {
    expect(classifyTaskComplexity({ userMessage: 'Salam, necəsən?', messageHistoryLen: 1, hasAttachments: false })).toBe('fast');
  });

  it('treats refactor/architecture requests as smart', () => {
    expect(classifyTaskComplexity({ userMessage: 'Bu kodu refactor et və architecture-i yenidən qurub', messageHistoryLen: 2, hasAttachments: false })).toBe('smart');
  });

  it('uses smart when there are attachments', () => {
    expect(classifyTaskComplexity({ userMessage: 'baxa bilərsən?', messageHistoryLen: 1, hasAttachments: true })).toBe('smart');
  });

  it('uses smart for long-running conversations', () => {
    expect(classifyTaskComplexity({ userMessage: 'davam et', messageHistoryLen: 20, hasAttachments: false })).toBe('smart');
  });

  it('uses smart for long messages with code blocks', () => {
    const text = '```js\n' + 'x'.repeat(600) + '\n```';
    expect(classifyTaskComplexity({ userMessage: text, messageHistoryLen: 1, hasAttachments: false })).toBe('smart');
  });

  it('uses fast for unknown short messages', () => {
    expect(classifyTaskComplexity({ userMessage: 'README oxu', messageHistoryLen: 1, hasAttachments: false })).toBe('fast');
  });
});
