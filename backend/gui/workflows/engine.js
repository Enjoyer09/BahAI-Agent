// ==========================================
// GUI Workflow Engine
// 
// Orchestrates multi-step GUI automation workflows.
// Handles: navigation, human checkpoints, grounding,
// reflection, safety checks, and reporting.
// ==========================================

const { getSession } = require('../../browserSession');
const { captureObservation, executeGuiAction } = require('../runtime');
const { groundElement, reflectOnAction } = require('../grounding');
const { assessGuiAction, normalizeGuiActionCandidate } = require('../provider');
const { isSafeGuiAction } = require('./seo-audit');

/**
 * GUI Workflow Runner — executes a goal-driven workflow with visual grounding.
 * 
 * This is the core loop that Agent-S implements in its `cli_app.py`:
 * screenshot → plan → ground → execute → reflect → repeat
 *
 * @param {Object} options
 * @param {string} options.sessionId - Browser session ID
 * @param {string} options.workingDirectory - Working dir for screenshots
 * @param {string} options.goal - High-level goal
 * @param {Array} options.steps - Workflow steps from buildSeoWorkflowSteps()
 * @param {Function} options.onEvent - SSE event emitter (type, data)
 * @param {Function} options.onHumanCheckpoint - Wait for human input
 * @param {Function} options.getNextAction - LLM call to decide next action
 * @param {Object} [options.engineParams] - Grounding model config
 * @param {number} [options.maxTotalSteps=30] - Safety limit
 */
async function runGuiWorkflow({
  sessionId = 'default',
  workingDirectory,
  goal,
  steps = [],
  onEvent,
  onHumanCheckpoint,
  getNextAction,
  engineParams = {},
  maxTotalSteps = 30
}) {
  const history = [];
  let totalSteps = 0;
  let currentStepIdx = 0;
  let done = false;

  onEvent('workflow_start', { goal, totalSteps: steps.length, sessionId });

  while (currentStepIdx < steps.length && totalSteps < maxTotalSteps && !done) {
    const step = steps[currentStepIdx];
    onEvent('workflow_step', { stepId: step.id, instruction: step.instruction, stepIndex: currentStepIdx });

    // ─── Step: Direct navigation ───
    if (step.action?.type === 'navigate') {
      const session = await getSession(sessionId);
      await session.page.goto(step.action.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await session.page.waitForTimeout(2000); // Wait for page to settle
      
      const obs = await captureObservation({ sessionId, workingDirectory });
      history.push({ step: step.id, action: step.action, observation: obs });
      onEvent('action_executed', { action: step.action, result: { ok: true, summary: `Navigated to ${step.action.url}` }, screenshot: obs.screenshotPath });
      
      currentStepIdx++;
      totalSteps++;
      continue;
    }

    // ─── Step: Human checkpoint (login wait) ───
    if (step.requiresHuman && step.humanCheckpoint) {
      onEvent('human_checkpoint', step.humanCheckpoint);
      
      // Wait for human to confirm
      const humanResult = await onHumanCheckpoint(step.humanCheckpoint);
      
      if (humanResult === 'cancel') {
        onEvent('workflow_cancelled', { step: step.id, reason: 'User cancelled' });
        done = true;
        break;
      }

      // Human confirmed — take a fresh screenshot
      await new Promise(r => setTimeout(r, 1500));
      const obs = await captureObservation({ sessionId, workingDirectory });
      history.push({ step: step.id, action: { type: 'human_checkpoint' }, observation: obs });
      onEvent('checkpoint_resolved', { screenshot: obs.screenshotPath, title: obs.title, url: obs.url });
      
      currentStepIdx++;
      totalSteps++;
      continue;
    }

    // ─── Step: Agent-driven (screenshot → plan → execute → reflect) ───
    const maxAttempts = step.maxAttempts || 5;
    let attempts = 0;
    let stepComplete = false;

    while (attempts < maxAttempts && !stepComplete && totalSteps < maxTotalSteps) {
      // 1. Capture current state
      const obs = await captureObservation({ sessionId, workingDirectory });
      
      onEvent('observation', {
        screenshot: obs.screenshotPath,
        title: obs.title,
        url: obs.url,
        step: step.id,
        attempt: attempts + 1
      });

      // 2. Ask LLM for next action (with screenshot context)
      const agentDecision = await getNextAction({
        goal,
        stepInstruction: step.instruction,
        observation: obs,
        history: history.slice(-6),
        attempt: attempts + 1,
        maxAttempts
      });

      if (!agentDecision) {
        onEvent('error', { message: 'Agent returned no decision', step: step.id });
        attempts++;
        totalSteps++;
        continue;
      }

      // 3. Handle special action types
      if (agentDecision.type === 'report') {
        // Agent is reporting findings — step complete
        onEvent('seo_report', {
          findings: agentDecision.findings || [],
          recommendations: agentDecision.recommendations || [],
          reasoning: agentDecision.reasoning || ''
        });
        stepComplete = true;
        history.push({ step: step.id, action: agentDecision, observation: obs });
        break;
      }

      if (agentDecision.type === 'done') {
        stepComplete = true;
        done = true;
        onEvent('workflow_done', { reasoning: agentDecision.reasoning, totalSteps });
        break;
      }

      // 4. Safety check
      const safetyCheck = isSafeGuiAction(agentDecision);
      if (!safetyCheck.safe) {
        onEvent('action_blocked', {
          action: agentDecision,
          reason: safetyCheck.reason
        });
        attempts++;
        totalSteps++;
        continue;
      }

      // 5. Assess action validity
      const assessment = assessGuiAction(agentDecision, { minConfidence: 0.25 });
      if (!assessment.executable) {
        onEvent('action_rejected', {
          action: agentDecision,
          reason: assessment.reason
        });
        attempts++;
        totalSteps++;
        continue;
      }

      // 6. Execute the action
      const beforeObs = obs;
      let result;
      try {
        result = await executeGuiAction({ sessionId, action: assessment.action });
      } catch (execErr) {
        result = { ok: false, summary: `Execution error: ${execErr.message}` };
      }

      onEvent('action_executed', {
        action: assessment.action,
        result,
        screenshot: beforeObs.screenshotPath
      });

      // 7. Wait for page to react
      await new Promise(r => setTimeout(r, 1500));

      // 8. Reflection — compare before/after
      const afterObs = await captureObservation({ sessionId, workingDirectory });
      
      let reflection = { success: result.ok, assessment: result.summary, nextStep: 'Continue.' };
      if (engineParams.apiKey && engineParams.apiKey !== 'ollama') {
        try {
          reflection = await reflectOnAction({
            goal: `${goal} — current step: ${step.instruction}`,
            lastAction: `${assessment.action.type}: ${assessment.action.description || assessment.action.reasoning || ''}`,
            screenshotBefore: beforeObs.screenshotBase64,
            screenshotAfter: afterObs.screenshotBase64,
            engineParams
          });
        } catch { /* use basic reflection */ }
      }

      onEvent('reflection', {
        success: reflection.success,
        assessment: reflection.assessment,
        nextStep: reflection.nextStep
      });

      history.push({
        step: step.id,
        action: assessment.action,
        result,
        reflection,
        observation: afterObs
      });

      // Check if step goal is met
      if (reflection.success && step.successCriteria) {
        // Simple heuristic: if reflection says success and we've done at least 2 attempts, move on
        if (attempts >= 1 || /found|visible|opened|loaded|settings|seo/i.test(reflection.assessment)) {
          stepComplete = true;
        }
      }

      attempts++;
      totalSteps++;
    }

    if (!stepComplete && !done) {
      onEvent('step_timeout', { step: step.id, attempts, maxAttempts });
    }

    currentStepIdx++;
  }

  if (!done) {
    onEvent('workflow_complete', { totalSteps, stepsCompleted: currentStepIdx });
  }

  return { history, totalSteps, completed: done || currentStepIdx >= steps.length };
}

module.exports = { runGuiWorkflow };
