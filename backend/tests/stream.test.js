import { describe, it, expect, vi } from 'vitest';
import { collectStreamOutput, detectRepetitionLoop, truncateAtRepetition } from '../chat/stream.js';
import helpers from '../helpers.js';
const { extractTextToolCalls } = helpers;

function makeStream(modelName) {
  return {
    [Symbol.asyncIterator]: async function* () {
      yield { model: modelName, choices: [{ delta: { content: 'Salam' }, finish_reason: null }] };
      yield { choices: [{ delta: {}, finish_reason: 'stop' }] };
    }
  };
}

async function runCollect(productMode, modelName) {
  const events = [];
  const res = { writableEnded: false };
  await collectStreamOutput({
    stream: makeStream(modelName),
    wireApi: 'chat_completions',
    res,
    writeSse: (_r, payload) => events.push(payload),
    normalizeToolName: (name) => name,
    extractTextToolCalls: (text) => ({ cleanedText: text, toolCalls: [] }),
    buildToolCallCacheKey: (name, args) => `${name}::${args}`,
    flattenResponseJsonText: (text) => text,
    normalizeFinalAssistantReport: (text) => text,
    productMode,
    auditStyleRequest: false,
    plannerArtifact: null,
    executionArtifacts: [],
    executionMemory: null,
    phaseTools: [],
    step: 1
  });
  return events;
}

function makeRepetitionStream(repeatedPhrase, repeatCount) {
  return {
    [Symbol.asyncIterator]: async function* () {
      yield { model: 'auto-fast-model', choices: [{ delta: { content: 'Cavab: ', finish_reason: null } }] };
      for (let i = 0; i < repeatCount; i += 1) {
        yield { choices: [{ delta: { content: repeatedPhrase, finish_reason: null } }] };
      }
      yield { choices: [{ delta: {}, finish_reason: 'stop' }] };
    }
  };
}

async function runCollectWithStream(stream, productMode = 'web_chat') {
  const events = [];
  const res = { writableEnded: false };
  const output = await collectStreamOutput({
    stream,
    wireApi: 'chat_completions',
    res,
    writeSse: (_r, payload) => events.push(payload),
    normalizeToolName: (name) => name,
    extractTextToolCalls: (text) => ({ cleanedText: text, toolCalls: [] }),
    buildToolCallCacheKey: (name, args) => `${name}::${args}`,
    flattenResponseJsonText: (text) => text,
    normalizeFinalAssistantReport: (text) => text,
    productMode,
    auditStyleRequest: false,
    plannerArtifact: null,
    executionArtifacts: [],
    executionMemory: null,
    phaseTools: [],
    step: 1
  });
  return { events, output };
}

describe('detectRepetitionLoop + truncateAtRepetition', () => {
  it('detects a repeated sentence (degenerate loop)', () => {
    const phrase = 'Bu, sualin həqiqətinə yönəldilməsi üçün fəlsəfə və təcrübə ilə suala baxmaqdır.';
    const content = `Sualınıza baxıram. ${phrase} ${phrase} ${phrase} ${phrase}`;
    const detection = detectRepetitionLoop(content);
    expect(detection).toBeTruthy();
    expect(detection.phrase).toContain('fəlsəfə və təcrübə');
    expect(detection.count).toBeGreaterThanOrEqual(4);
  });

  it('returns null for normal prose', () => {
    const content = 'Azərbaycanda elektrik avtomobilləri bazarı inkişaf edir. Əsas rəqiblər Tesla, BYD və Hyundai-dir. Dövlət güzəştləri 2026-cı ildə genişləndirilib.';
    expect(detectRepetitionLoop(content)).toBeNull();
  });

  it('truncates case-insensitively when the model varies capitalization', () => {
    // Detection lowercases keys; truncation must match the same way or the
    // second occurrence is missed when repeats change case (common in loops).
    const content = 'Sualınıza baxıram. Bu, sualin həqiqətinə yönəldilməsi üçün fəlsəfə və təcrübə ilə suala baxmaqdır. bu, sualin həqiqətinə yönəldilməsi üçün fəlsəfə və təcrübə ilə suala baxmaqdır. BU, sualin həqiqətinə yönəldilməsi üçün fəlsəfə və təcrübə ilə suala baxmaqdır. Bu, sualin həqiqətinə yönəldilməsi üçün fəlsəfə və təcrübə ilə suala baxmaqdır.';
    const detection = detectRepetitionLoop(content);
    expect(detection).toBeTruthy();
    const truncated = truncateAtRepetition(content, detection);
    expect(truncated).toContain('Sualınıza baxıram.');
    // Only the first occurrence (plus the intro) survives despite case drift.
    expect(truncated.split(/bu, sualin/i).length).toBeLessThanOrEqual(2);
  });

  it('truncates content at the second occurrence of the repeated phrase', () => {
    const phrase = 'Bu, sualin həqiqətinə yönəldilməsi üçün fəlsəfə və təcrübə ilə suala baxmaqdır.';
    const content = `Sualınıza baxıram. ${phrase} ${phrase} ${phrase} ${phrase}`;
    const detection = detectRepetitionLoop(content);
    expect(detection).toBeTruthy();
    const truncated = truncateAtRepetition(content, detection);
    expect(truncated).toContain('Sualınıza baxıram.');
    // Only the first occurrence (plus the intro) survives.
    expect(truncated.split(phrase).length).toBeLessThanOrEqual(2);
  });
});

describe('collectStreamOutput degenerate repetition guard', () => {
  it('cuts the stream early and returns degenerateLoop for a looping model', async () => {
    const phrase = 'Bu, sualin həqiqətinə yönəldilməsi üçün fəlsəfə və təcrübə ilə suala baxmaqdır.';
    const { output } = await runCollectWithStream(makeRepetitionStream(phrase, 12));
    expect(output.degenerateLoop).toBeTruthy();
    // The final content is truncated, not the full 12× loop.
    expect(output.accumulatedContent.split(phrase).length).toBeLessThanOrEqual(2);
  });

  it('passes healthy streams through untouched', async () => {
    const { output, events } = await runCollectWithStream({
      [Symbol.asyncIterator]: async function* () {
        yield { model: 'auto-gpt-5.5', choices: [{ delta: { content: 'Normal cavab.', finish_reason: null } }] };
        yield { choices: [{ delta: {}, finish_reason: 'stop' }] };
      }
    });
    expect(output.degenerateLoop).toBeFalsy();
    expect(output.accumulatedContent).toBe('Normal cavab.');
    expect(events.some((e) => e.type === 'assistant_delta')).toBe(true);
  });
});

describe('collectStreamOutput provider/model leak guard', () => {
  it('never emits auto_route or token_usage to web chat', async () => {
    const events = await runCollect('web_chat', 'auto-gpt-5.5');
    expect(events.some((e) => e.type === 'auto_route')).toBe(false);
    // Web clients must not receive token usage at all — otherwise it would be
    // persisted into web project memory.
    expect(events.some((e) => e.type === 'token_usage')).toBe(false);
  });

  it('emits auto_route with the resolved model for desktop products', async () => {
    const events = await runCollect('desktop_code', 'auto-gpt-5.5');
    const autoRoute = events.find((e) => e.type === 'auto_route');
    expect(autoRoute).toBeTruthy();
    expect(autoRoute.chosenModel).toBe('auto-gpt-5.5');
    const tokenUsage = events.find((e) => e.type === 'token_usage');
    expect(tokenUsage.model).toBe('auto-gpt-5.5');
  });

  it('still streams assistant deltas to web chat', async () => {
    const events = await runCollect('web_chat', 'auto-gpt-5.5');
    expect(events.some((e) => e.type === 'assistant_delta' && e.content === 'Salam')).toBe(true);
  });
});

// Real extractTextToolCalls so tool-call extraction behaves like production.
async function runCollectWithStreamAndTools(stream, phaseTools = [{ function: { name: 'web_search' } }], productMode = 'web_chat') {
  const events = [];
  const res = { writableEnded: false };
  const output = await collectStreamOutput({
    stream,
    wireApi: 'chat_completions',
    res,
    writeSse: (_r, payload) => events.push(payload),
    normalizeToolName: (name) => name,
    extractTextToolCalls,
    buildToolCallCacheKey: (name, args) => `${name}::${args}`,
    flattenResponseJsonText: (text) => text,
    normalizeFinalAssistantReport: (text) => text,
    productMode,
    auditStyleRequest: false,
    plannerArtifact: null,
    executionArtifacts: [],
    executionMemory: null,
    phaseTools,
    step: 1
  });
  return { events, output };
}

describe('(b) tool-call JSON leak guard', () => {
  it('withholds a complete text tool call from the live stream and extracts it', async () => {
    const callText = 'Məlumatı yoxlayıram.\n```json\n{"name":"web_search","arguments":{"query":"Bakı hava"}}\n```\n';
    const stream = {
      [Symbol.asyncIterator]: async function* () {
        yield { choices: [{ delta: { content: callText, finish_reason: null } }] };
        yield { choices: [{ delta: {}, finish_reason: 'stop' }] };
      }
    };
    const { events, output } = await runCollectWithStreamAndTools(stream);

    // The raw JSON must never appear in any streamed delta.
    const leaked = events.some((e) => e.type === 'assistant_delta' && /web_search/.test(e.content || ''));
    expect(leaked).toBe(false);
    // The final message content must not contain the tool-call JSON.
    expect(output.accumulatedContent).not.toMatch(/web_search/);
    // The tool call must have been extracted into a real tool call.
    expect(output.normalizedToolCalls.some((tc) => tc.function.name === 'web_search')).toBe(true);
  });

  it('strips a truncated tool-call fragment so it never reaches the final message', async () => {
    // Stream cut off mid-frame — exactly the `"{` symptom from the screenshot.
    const fragment = '```json\n{"name":"web_search","arguments":';
    const stream = {
      [Symbol.asyncIterator]: async function* () {
        yield { choices: [{ delta: { content: fragment, finish_reason: 'stop' } }] };
      }
    };
    const { events, output } = await runCollectWithStreamAndTools(stream);

    const leaked = events.some((e) => e.type === 'assistant_delta' && /web_search|```json/.test(e.content || ''));
    expect(leaked).toBe(false);
    expect(output.accumulatedContent).not.toMatch(/web_search/);
    expect(output.accumulatedContent).not.toMatch(/```json/);
    expect(output.accumulatedContent).not.toMatch(/\{"/);
  });

  it('still streams normal prose that merely contains braces', async () => {
    const stream = {
      [Symbol.asyncIterator]: async function* () {
        yield { choices: [{ delta: { content: 'Set x = { "a": 1 } and continue.', finish_reason: 'stop' } }] };
      }
    };
    const { events, output } = await runCollectWithStreamAndTools(stream);
    expect(events.some((e) => e.type === 'assistant_delta' && /Set x/.test(e.content || ''))).toBe(true);
    expect(output.accumulatedContent).toBe('Set x = { "a": 1 } and continue.');
  });
});
