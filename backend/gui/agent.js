const { captureObservation, executeGuiAction } = require('./runtime');
const { buildGuiGroundingPrompt, normalizeGuiActionCandidate, assessGuiAction, buildGuiReflection, resolveGroundedAction } = require('./provider');

async function inspectGuiState({ sessionId = 'default', workingDirectory, goal = '', history = [] }) {
  const observation = await captureObservation({ sessionId, workingDirectory });
  return {
    observation,
    groundingPrompt: buildGuiGroundingPrompt({ goal, observation, history })
  };
}

async function runGuiAction({ sessionId = 'default', workingDirectory, action, history = [], minConfidence = 0.35 }) {
  const normalizedAction = normalizeGuiActionCandidate(action);
  const assessment = assessGuiAction(normalizedAction, { minConfidence });
  if (!assessment.executable) {
    const observation = await captureObservation({ sessionId, workingDirectory });
    const reflection = {
      goal: '',
      success: false,
      action: assessment.action,
      result: { ok: false, summary: assessment.reason },
      observation,
      nextRecommendation: 'Inspect the GUI state and choose a safer grounded action.'
    };
    return {
      action: assessment.action,
      assessment,
      result: reflection.result,
      observation,
      reflection,
      history: [...history, { action: assessment.action, result: reflection.result, observation, reflection }].slice(-8)
    };
  }

  const result = await executeGuiAction({ sessionId, action: normalizedAction });
  const observation = await captureObservation({ sessionId, workingDirectory });
  const reflection = buildGuiReflection({
    goal: '',
    action: normalizedAction,
    result,
    observation
  });
  return {
    action: normalizedAction,
    assessment,
    result,
    observation,
    reflection,
    history: [...history, { action: normalizedAction, result, observation, reflection }].slice(-8)
  };
}

async function stepGuiAgent({
  sessionId = 'default',
  workingDirectory,
  goal = '',
  action,
  history = [],
  grounding = {},
  autoGround = false,
  groundingMode = 'prompt_only',
  minConfidence = 0.35
}) {
  const inspection = await inspectGuiState({ sessionId, workingDirectory, goal, history });

  if (!action && (!autoGround || groundingMode === 'prompt_only')) {
    return {
      ...inspection,
      action: null,
      assessment: {
        executable: false,
        action: null,
        reason: 'Auto grounding is disabled; returning observation and grounding prompt only.'
      },
      result: null,
      reflection: {
        goal,
        success: false,
        action: null,
        result: null,
        observation: inspection.observation,
        nextRecommendation: 'Use the grounding prompt to choose a manual action or enable autoGround.'
      },
      history: Array.isArray(history) ? history.slice(-8) : []
    };
  }

  const grounded = action
    ? assessGuiAction(action, { minConfidence })
    : await resolveGroundedAction({
        client: grounding.client,
        model: grounding.model,
        goal,
        observation: inspection.observation,
        history,
        minConfidence
      });

  if (!grounded.executable) {
    return {
      ...inspection,
      action: grounded.action,
      assessment: grounded,
      result: { ok: false, summary: grounded.reason },
      reflection: {
        goal,
        success: false,
        action: grounded.action,
        result: { ok: false, summary: grounded.reason },
        observation: inspection.observation,
        nextRecommendation: 'Inspect the current page and retry with a more precise, higher-confidence GUI action.'
      },
      history: [...history, { action: grounded.action, result: { ok: false, summary: grounded.reason }, observation: inspection.observation }].slice(-8)
    };
  }

  const actionResult = await runGuiAction({ sessionId, workingDirectory, action: grounded.action, history, minConfidence });
  actionResult.reflection.goal = goal;
  return {
    ...inspection,
    ...actionResult
  };
}

module.exports = {
  inspectGuiState,
  runGuiAction,
  stepGuiAgent
};
