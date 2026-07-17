function writeSse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function finishSse(res) {
  if (!res || res.writableEnded) return;
  res.write('data: [DONE]\n\n');
}

function initSse(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
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

module.exports = {
  writeSse,
  initSse,
  emitOrchestrationPrelude,
  emitTaskPlan,
  emitGovernanceState,
  emitProviderTelemetry,
  finishSse
};
