/**
 * Detects a degenerate repetition loop in streaming assistant output — the
 * failure mode where a (typically small/fast) model repeats the same sentence
 * over and over instead of answering (observed with Azerbaijani research
 * questions routed to the fast model: "...fəlsəfə və təcrübə ilə suala
 * baxmaqdır." × 30). Returns the repeated phrase + count, or null.
 */
function detectRepetitionLoop(content = '', { minPhraseLength = 24, maxRepeats = 4 } = {}) {
  const text = String(content || '');
  if (text.length < minPhraseLength * maxRepeats) return null;
  const normalized = text
    .replace(/\s+/g, ' ')
    // Token streams can concatenate sentence boundaries without whitespace
    // ("...baxmaqdır.Bu, ..."). Insert a break after sentence punctuation
    // followed by a capital letter so repetition stays detectable.
    .replace(/([.!?…])(?=[A-ZƏİÖÜĞÇŞ"'«(])/g, '$1 ')
    .trim();
  // Split into sentences on [.!?…] followed by whitespace.
  const sentences = normalized.split(/(?<=[.!?…])\s+/);
  const counts = new Map();
  for (const raw of sentences) {
    const sentence = String(raw || '').trim();
    if (sentence.length < minPhraseLength) continue;
    const key = sentence.toLowerCase();
    const count = (counts.get(key) || 0) + 1;
    counts.set(key, count);
    if (count >= maxRepeats) {
      return { phrase: sentence, count };
    }
  }
  return null;
}

/**
 * Cuts repeated content at the start of the second occurrence of the detected
 * phrase, so the user sees the (useful) prefix instead of the infinite loop.
 * Search is case-insensitive to match detectRepetitionLoop's lowercased keys:
 * degenerate loops often vary capitalization between repeats.
 */
function truncateAtRepetition(content = '', detection = null) {
  if (!detection || !detection.phrase) return content;
  const text = String(content || '');
  const phrase = detection.phrase;
  const lowerText = text.toLowerCase();
  const lowerPhrase = phrase.toLowerCase();
  const firstIdx = lowerText.indexOf(lowerPhrase);
  if (firstIdx === -1) return text;
  const secondIdx = lowerText.indexOf(lowerPhrase, firstIdx + lowerPhrase.length);
  if (secondIdx === -1) return text;
  return text.slice(0, secondIdx).trim();
}

function filterToolCallsByPhase(toolCalls = [], phaseTools = [], normalizeToolName = (name) => name) {
  const allowedToolNames = new Set(
    phaseTools
      .map((tool) => normalizeToolName(tool?.function?.name))
      .filter(Boolean)
  );
  return toolCalls.filter((toolCall) => (
    allowedToolNames.has(normalizeToolName(toolCall?.function?.name))
  ));
}

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
  let deferStructuredOutput = false;
  let degenerateLoop = null;
  // Only re-run the (slightly costly) repetition scan when the buffer has
  // grown by ~160 chars since the last check — every-chunk scanning is wasted
  // work on long healthy answers.
  let lastRepetitionCheckLen = 0;

  const maybeDetectRepetition = () => {
    if (degenerateLoop) return;
    if (accumulatedContent.length - lastRepetitionCheckLen < 160) return;
    lastRepetitionCheckLen = accumulatedContent.length;
    const detection = detectRepetitionLoop(accumulatedContent);
    if (detection) {
      degenerateLoop = detection;
      accumulatedContent = truncateAtRepetition(accumulatedContent, detection);
    }
  };

  // Web chat must never receive provider/model names — auto_route is a
  // desktop-only routing indicator. Track the resolved model internally for
  // token_usage/logs, but only emit the SSE event for non-web products.
  const canEmitAutoRoute = productMode !== 'web_chat';
  if (stream && stream.response && typeof stream.response.headers?.get === 'function') {
    const omniModel = stream.response.headers.get('x-omniroute-model');
    if (omniModel) {
      resolvedModel = omniModel;
      if (canEmitAutoRoute) {
        writeSse(res, { type: 'auto_route', chosenModel: resolvedModel, intent: 'smart' });
      }
    }
  }

  try {
    for await (const chunk of stream) {
    if (chunk && chunk.model && !resolvedModel) {
      resolvedModel = chunk.model;
      if (canEmitAutoRoute) {
        writeSse(res, { type: 'auto_route', chosenModel: resolvedModel, intent: 'smart' });
      }
    }
    if (wireApi === 'responses') {
      if (chunk.type === 'response.output_text.delta') {
        accumulatedContent += chunk.delta;
        sawAssistantDelta = true;
        maybeDetectRepetition();
        if (degenerateLoop) break;
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
      const nextContent = accumulatedContent + delta.content;
      // Only defer when the opening really looks like a tool-call JSON block
      // (extractTextToolCalls requires a "name"/"arguments" pair). A normal
      // answer that merely starts with "{" or a ```json example must stream
      // immediately — full deferral made slow models feel frozen.
      if (!accumulatedContent && /^\s*(?:```(?:json)?\s*)?\{\s*"(?:name|tool|function|action)"/.test(nextContent)) {
        deferStructuredOutput = true;
      }
      accumulatedContent += delta.content;
      sawAssistantDelta = true;
      maybeDetectRepetition();
      if (degenerateLoop) break;
      if (!deferStructuredOutput) {
        writeSse(res, { type: 'assistant_delta', content: delta.content });
      }
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
  } catch (error) {
    const message = String(error?.message || error || '').toLowerCase();
    if (
      message.includes('could not parse message into json') ||
      message.includes('event: error') ||
      message.includes('unspecified error')
    ) {
      throw Object.assign(new Error('Provider stream error'), {
        status: error?.status || 502,
        code: 'PROVIDER_STREAM_ERROR',
        cause: error
      });
    }
    throw error;
  }

  if (degenerateLoop) {
    console.warn(`[REPETITION_LOOP] Model loop-a düşdü (${degenerateLoop.count}× təkrarlanan cümlə): ${JSON.stringify(String(degenerateLoop.phrase).slice(0, 120))}`);
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
  normalizedToolCalls = filterToolCallsByPhase(normalizedToolCalls, phaseTools, normalizeToolName);

  accumulatedContent = flattenResponseJsonText(accumulatedContent || '');
  const { cleanWebAssistantResponse } = require('./webRagCleaner');
  const { verifyAndCleanAssistantResponse } = require('./verifierGuardrail');
  accumulatedContent = cleanWebAssistantResponse(accumulatedContent, productMode === 'web_chat');
  accumulatedContent = verifyAndCleanAssistantResponse(accumulatedContent, productMode === 'web_chat');

  if (!normalizedToolCalls.length && accumulatedContent.trim()) {
    accumulatedContent = normalizeFinalAssistantReport(accumulatedContent, {
      productMode,
      auditStyleRequest,
      plannerArtifact,
      executionArtifacts,
      executionMemory
    });
  }

  // Web chat never receives provider/model internals: token usage is a desktop
  // ops-panel detail and must not reach web clients at all (it would otherwise
  // be persisted into web project memory). Resolve the model name internally
  // for server logs, but do not emit the SSE event for web products.
  if (productMode !== 'web_chat') {
    const promptTokens = Math.ceil((step + 1) * 350);
    const completionTokens = Math.ceil((accumulatedContent.length + JSON.stringify(normalizedToolCalls).length) / 4);
    writeSse(res, { type: 'token_usage', promptTokens, completionTokens, model: resolvedModel || 'auto' });
  }

  return {
    finishReason,
    sawAssistantDelta,
    sawCompletedEvent,
    accumulatedContent,
    accumulatedReasoning,
    normalizedToolCalls,
    degenerateLoop,
    message: {
      role: 'assistant',
      content: accumulatedContent || null,
      reasoning_content: accumulatedReasoning || undefined,
      tool_calls: normalizedToolCalls.length > 0 ? normalizedToolCalls : undefined
    }
  };
}

module.exports = {
  collectStreamOutput,
  filterToolCallsByPhase,
  detectRepetitionLoop,
  truncateAtRepetition
};
