async function collectStreamOutput({
  stream,
  wireApi,
  res,
  writeSse,
  normalizeToolName,
  extractTextToolCalls,
  buildToolCallCacheKey,
  flattenResponseJsonText,
  normalizeFinalAssistantReport,
  productMode,
  auditStyleRequest,
  plannerArtifact,
  executionArtifacts,
  executionMemory,
  phaseTools,
  step
}) {
  let accumulatedContent = '';
  let accumulatedReasoning = '';
  const accumulatedToolCalls = [];
  let finishReason = null;
  let sawAssistantDelta = false;
  let sawCompletedEvent = false;
  let resolvedModel = null;

  for await (const chunk of stream) {
    if (chunk && chunk.model && !resolvedModel) {
      resolvedModel = chunk.model;
      writeSse(res, { type: 'auto_route', chosenModel: resolvedModel, intent: 'smart' });
    }
    if (wireApi === 'responses') {
      if (chunk.type === 'response.output_text.delta') {
        accumulatedContent += chunk.delta;
        sawAssistantDelta = true;
        writeSse(res, { type: 'assistant_delta', content: chunk.delta });
      }

      if (chunk.type === 'response.reasoning_text.delta' || chunk.type === 'response.reasoning_summary_text.delta') {
        accumulatedReasoning += chunk.delta;
      }

      if (chunk.type === 'response.output_item.added' && chunk.item?.type === 'function_call') {
        const idx = chunk.output_index ?? accumulatedToolCalls.length;
        accumulatedToolCalls[idx] = {
          id: chunk.item.call_id || chunk.item.id || '',
          type: 'function',
          function: {
            name: chunk.item.name || '',
            arguments: chunk.item.arguments || ''
          }
        };
      }

      if (chunk.type === 'response.function_call_arguments.delta') {
        const idx = chunk.output_index ?? 0;
        if (!accumulatedToolCalls[idx]) {
          accumulatedToolCalls[idx] = { id: '', type: 'function', function: { name: '', arguments: '' } };
        }
        accumulatedToolCalls[idx].function.arguments = chunk.snapshot || ((accumulatedToolCalls[idx].function.arguments || '') + chunk.delta);
      }

      if (chunk.type === 'response.completed') {
        finishReason = 'stop';
        sawCompletedEvent = true;
      }
      continue;
    }

    const delta = chunk.choices[0]?.delta;
    if (!delta) continue;

    if (delta.content) {
      accumulatedContent += delta.content;
      sawAssistantDelta = true;
      writeSse(res, { type: 'assistant_delta', content: delta.content });
    }

    if (delta.reasoning_content) {
      accumulatedReasoning += delta.reasoning_content;
    }

    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0;
        if (!accumulatedToolCalls[idx]) {
          accumulatedToolCalls[idx] = { id: tc.id || '', type: 'function', function: { name: '', arguments: '' } };
        }
        if (tc.id) accumulatedToolCalls[idx].id = tc.id;
        if (tc.function?.name) accumulatedToolCalls[idx].function.name += tc.function.name;
        if (tc.function?.arguments) accumulatedToolCalls[idx].function.arguments += tc.function.arguments;
      }
    }

    if (chunk.choices[0]?.finish_reason) {
      finishReason = chunk.choices[0].finish_reason;
    }
  }

  let normalizedToolCalls = accumulatedToolCalls
    .filter((tc) => tc && tc.function && tc.function.name)
    .map((tc, idx) => ({
      id: tc.id || `toolcall_${step}_${idx}_${Date.now()}`,
      type: 'function',
      function: {
        name: normalizeToolName(tc.function.name),
        arguments: tc.function.arguments || '{}'
      }
    }));

  let textToolCalls = [];
  if (accumulatedContent) {
    try {
      const parseResult = extractTextToolCalls(accumulatedContent, phaseTools);
      accumulatedContent = parseResult.cleanedText;
      textToolCalls = parseResult.toolCalls.map((tc, idx) => ({
        id: `toolcall_text_${step}_${idx}_${Date.now()}`,
        type: 'function',
        function: {
          name: normalizeToolName(tc.name),
          arguments: tc.arguments
        }
      }));
    } catch (parseErr) {
      console.error('⚠️ Fallback tool call parser xətası:', parseErr);
    }
  }

  if (textToolCalls.length > 0) {
    console.log(`🔌 Intercepted ${textToolCalls.length} raw text tool call(s):`, JSON.stringify(textToolCalls));
    if (textToolCalls.length > 1) {
      console.log('⚠️ Multiple tool calls found in text. To prevent hallucination loop, keeping only the first one.');
      textToolCalls = [textToolCalls[0]];
    }
    normalizedToolCalls = [...normalizedToolCalls, ...textToolCalls];
  }

  normalizedToolCalls = normalizedToolCalls.filter((toolCall, index, source) => {
    const cacheKey = buildToolCallCacheKey(toolCall?.function?.name, toolCall?.function?.arguments);
    return source.findIndex((candidate) => (
      buildToolCallCacheKey(candidate?.function?.name, candidate?.function?.arguments) === cacheKey
    )) === index;
  });

  accumulatedContent = flattenResponseJsonText(accumulatedContent || '');
  if (!normalizedToolCalls.length && accumulatedContent.trim()) {
    accumulatedContent = normalizeFinalAssistantReport(accumulatedContent, {
      productMode,
      auditStyleRequest,
      plannerArtifact,
      executionArtifacts,
      executionMemory
    });
  }

  return {
    finishReason,
    sawAssistantDelta,
    sawCompletedEvent,
    accumulatedContent,
    accumulatedReasoning,
    normalizedToolCalls,
    message: {
      role: 'assistant',
      content: accumulatedContent || null,
      reasoning_content: accumulatedReasoning || undefined,
      tool_calls: normalizedToolCalls.length > 0 ? normalizedToolCalls : undefined
    }
  };
}

module.exports = {
  collectStreamOutput
};
