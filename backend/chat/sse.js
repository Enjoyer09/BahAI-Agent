function writeSse(res, payload) {
  if (!res || res.writableEnded || res.destroyed) return;
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function finishSse(res) {
  if (!res || res.writableEnded) return;
  if (res._bahaiHeartbeat) {
    clearInterval(res._bahaiHeartbeat);
    res._bahaiHeartbeat = null;
  }
  res.write('data: [DONE]\n\n');
}

function initSse(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  if (!res._bahaiHeartbeat) {
    res._bahaiHeartbeat = setInterval(() => {
      if (res.writableEnded || res.destroyed) {
        clearInterval(res._bahaiHeartbeat);
        res._bahaiHeartbeat = null;
        return;
      }
      res.write(': heartbeat\n\n');
    }, 8000);
    res.on('close', () => {
      if (res._bahaiHeartbeat) {
        clearInterval(res._bahaiHeartbeat);
        res._bahaiHeartbeat = null;
      }
    });
  }
}

function emitOrchestrationPrelude(res, { runId, orchestration, runManager, pendingAutoRouteEvent }) {
  if (pendingAutoRouteEvent) {
    writeSse(res, pendingAutoRouteEvent);
  }

  writeSse(res, {
    type: 'orchestration_state',
    runId,
    workflow: orchestration.workflow,
    mode: orchestration.mode,
    agents: orchestration.agents,
    routing: orchestration.routing
  });

  if (orchestration.enabled) {
    writeSse(res, {
      type: 'orchestration_phase',
      ...runManager.snapshot()
    });
  }
}

function emitTaskPlan(res, items = []) {
  if (!Array.isArray(items) || items.length === 0) return;
  writeSse(res, { type: 'task_plan', items });
}

function emitGovernanceState(res, payload = {}) {
  writeSse(res, { type: 'governance_state', ...payload });
}

function emitProviderTelemetry(res, payload = {}) {
  writeSse(res, { type: 'provider_telemetry', ...payload });
}

function emitTokenUsage(res, payload = {}) {
  const promptTokens = payload.promptTokens || 0;
  const completionTokens = payload.completionTokens || 0;
  const totalTokens = promptTokens + completionTokens;
  // Estimated cost based on standard model rates ($0.0015/1k prompt, $0.002/1k output)
  const estimatedCostUSD = ((promptTokens * 0.0000015) + (completionTokens * 0.000002)).toFixed(6);
  writeSse(res, {
    type: 'token_usage',
    promptTokens,
    completionTokens,
    totalTokens,
    estimatedCostUSD,
    model: payload.model || 'auto'
  });
}

module.exports = {
  writeSse,
  initSse,
  emitOrchestrationPrelude,
  emitTaskPlan,
  emitGovernanceState,
  emitProviderTelemetry,
  emitTokenUsage,
  finishSse
};
