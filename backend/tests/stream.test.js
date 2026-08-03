import { describe, it, expect, vi } from 'vitest';
import { collectStreamOutput, detectRepetitionLoop, truncateAtRepetition } from '../chat/stream.js';

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
