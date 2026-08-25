/**
 * bahAI - MultiAgentManager
 * A central orchestration class to manage multi-agent workflows.
 * It coordinates the Planner, Coder (Executor), and Reviewer agents.
 */

const { buildRoleInstruction } = require('./rolePrompts');
const { QuantumEntangledAgents, createEntangledAgentsFromWorkflow } = require('./quantumEntanglement');
// Assumes a generic callModel function exists in the system
// const { callModel } = require('../chat/providers'); 

class MultiAgentManager {
  constructor(options = {}) {
    this.sessionContext = options.sessionContext || {};
    this.history = [];
    this.activeAgents = new Map();
    this.quantumEnabled = process.env.QUANTUM_ENTANGLEMENT_ENABLED === 'true';
    this.entangledAgents = null;
  }

  /**
   * Registers a new sub-agent for the session
   */
  registerAgent(agentRole, config) {
    this.activeAgents.set(agentRole, {
      roleInstruction: buildRoleInstruction(agentRole, config),
      tools: config.tools || [],
      context: [],
    });
  }

  /**
   * Delegates a task to a specific agent and captures the response
   */
  async delegateTask(agentRole, userPrompt) {
    const agent = this.activeAgents.get(agentRole);
    if (!agent) throw new Error(`Agent role ${agentRole} not found`);

    const messages = [
      { role: 'system', content: agent.roleInstruction },
      ...agent.context,
      { role: 'user', content: userPrompt }
    ];

    console.log(`[MultiAgentManager] Delegating task to ${agentRole}...`);
    
    // Pseudo-code for model calling
    // const response = await callModel({ messages, tools: agent.tools });
    const response = { role: 'assistant', content: `[${agentRole} Response]: Acknowledged.` };

    // Update agent's isolated context
    agent.context.push({ role: 'user', content: userPrompt });
    agent.context.push(response);

    // Update global history
    this.history.push({ agentRole, task: userPrompt, result: response.content });

    return response;
  }

  /**
   * Handoff context from one agent to another (e.g., Planner -> Coder)
   */
  handoffContext(fromRole, toRole) {
    const sourceAgent = this.activeAgents.get(fromRole);
    const targetAgent = this.activeAgents.get(toRole);
    
    if (!sourceAgent || !targetAgent) return;

    // Summarize or directly pass source context to target
    const summary = sourceAgent.context.map(m => m.content).join('\n');
    targetAgent.context.push({
      role: 'system',
      content: `Context received from ${fromRole}:\n${summary}`
    });
  }

  /**
   * Initialize quantum entanglement for a workflow (opt-in via QUANTUM_ENTANGLEMENT_ENABLED)
   */
  initQuantumEntanglement(workflow) {
    if (!this.quantumEnabled) return null;
    try {
      this.entangledAgents = createEntangledAgentsFromWorkflow(workflow);
      return this.entangledAgents;
    } catch (err) {
      console.warn(`[QuantumEntanglement] Init failed: ${err.message}`);
      return null;
    }
  }

  /**
   * Execute task with quantum entanglement (parallel agents) if enabled,
   * otherwise fall back to serial execution.
   */
  async executeEntangledOrSerial(task, taskPrompt, options = {}) {
    if (this.quantumEnabled && this.entangledAgents) {
      try {
        const result = await this.entangledAgents.executeEntangled(task, taskPrompt, options);
        // Convert quantum result to serial-compatible format
        return {
          content: result.result?.content || '',
          decision: result.result?.decision || 'neutral',
          consensus: result.result?.consensus || 'weak',
          quantum: true,
          correlations: result.correlations,
          speedup: result.parallelSpeedup
        };
      } catch (err) {
        console.warn(`[QuantumEntanglement] Execution failed, falling back to serial: ${err.message}`);
      }
    }
    // Fallback: serial execution (existing behavior)
    return null;
  }
}

module.exports = MultiAgentManager;
