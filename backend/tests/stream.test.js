import { describe, it, expect, vi } from 'vitest';
import { collectStreamOutput } from '../chat/stream.js';

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
