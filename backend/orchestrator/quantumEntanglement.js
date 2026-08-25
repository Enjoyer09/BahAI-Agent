/**
 * bahAI - Quantum Entangled Agents
 * 
 * A quantum-inspired multi-agent orchestration system where agents
 * (Planner, Builder, Reviewer, Security, QA, Architect) think SIMULTANEOUSLY
 * and share a "quantum state" — each agent's output influences the others
 * in real-time through entanglement correlations.
 * 
 * Key concepts from quantum mechanics:
 * - Superposition: All agents think at the same time (parallel)
 * - Entanglement: Agent outputs are correlated (shared state)
 * - Measurement: Final "collapse" merges all outputs into unified decision
 * - Quantum interference: Conflicting outputs cancel, agreeing outputs amplify
 * 
 * This replaces the serial Planner→Builder→Reviewer flow with:
 * [Planner ↔ Builder ↔ Reviewer] → parallel thinking → correlation → collapse
 * 
 * Expected improvement:
 * - Serial: T_total = T_planner + T_builder + T_reviewer (30-60s)
 * - Entangled: T_total = max(T_planner, T_builder, T_reviewer) + correlation (10-20s)
 */

// ============================================================================
// Shared Quantum State
// ============================================================================

class SharedQuantumState {
  constructor(initialContext = {}) {
    // Core shared state that all agents can read/write
    this.state = {
      // The original task
      task: initialContext.task || '',
      taskType: initialContext.taskType || 'general',
      
      // Agent outputs (updated as agents think)
      plan: null,           // Planner output
      implementation: null,  // Builder output
      review: null,          // Reviewer output
      security: null,        // Security output
      qa: null,              // QA output
      architecture: null,    // Architect output
      
      // Correlations between agents
      correlations: new Map(), // agent_pair → correlation_score
      
      // Shared insights (agents can add insights that others see)
      insights: [],
      
      // Risk flags (any agent can flag risks)
      risks: [],
      
      // Decisions made
      decisions: [],
      
      // Consensus tracking
      consensus: {
        agree: 0,
        disagree: 0,
        neutral: 0
      }
    };
    
    // Entanglement coefficients (how much agents influence each other)
    this.entanglementCoefficients = {
      'Planner-Builder': 0.8,    // Planner's plan strongly influences Builder
      'Planner-Reviewer': 0.6,   // Planner's plan moderately influences Reviewer
      'Builder-Reviewer': 0.9,   // Builder's work strongly influences Reviewer
      'Builder-Security': 0.7,   // Builder's code influences Security review
      'Reviewer-Security': 0.5,  // Reviewer's findings correlate with Security
      'Reviewer-QA': 0.7,        // Reviewer's review influences QA testing
      'Architect-Builder': 0.8,  // Architect's design strongly influences Builder
    };
  }
  
  /**
   * Read shared state (any agent can call this)
   */
  readState(agentRole) {
    return {
      task: this.state.task,
      taskType: this.state.taskType,
      // Return only relevant outputs (not the agent's own output)
      plan: agentRole !== 'Planner' ? this.state.plan : null,
      implementation: agentRole !== 'Builder' ? this.state.implementation : null,
      review: agentRole !== 'Reviewer' ? this.state.review : null,
      security: agentRole !== 'Security' ? this.state.security : null,
      qa: agentRole !== 'QA' ? this.state.qa : null,
      architecture: agentRole !== 'Architect' ? this.state.architecture : null,
      insights: this.state.insights,
      risks: this.state.risks,
      decisions: this.state.decisions,
      consensus: { ...this.state.consensus }
    };
  }
  
  /**
   * Write agent output to shared state
   */
  writeAgentOutput(agentRole, output) {
    const outputKey = this.getOutputKey(agentRole);
    if (outputKey) {
      this.state[outputKey] = output;
    }
    
    // Add to insights if agent provided any
    if (output?.insights) {
      this.state.insights.push(...output.insights);
    }
    
    // Add to risks if agent flagged any
    if (output?.risks) {
      this.state.risks.push(...output.risks);
    }
    
    // Track decisions
    if (output?.decision) {
      this.state.decisions.push({
        agent: agentRole,
        decision: output.decision,
        confidence: output.confidence || 0.5,
        timestamp: Date.now()
      });
    }
    
    // Update consensus
    this.updateConsensus(agentRole, output);
  }
  
  /**
   * Get output key for agent role
   */
  getOutputKey(agentRole) {
    const keyMap = {
      'Planner': 'plan',
      'Builder': 'implementation',
      'Reviewer': 'review',
      'Security': 'security',
      'QA': 'qa',
      'Architect': 'architecture'
    };
    return keyMap[agentRole] || null;
  }
  
  /**
   * Update consensus tracking based on agent output
   */
  updateConsensus(agentRole, output) {
    if (!output?.agreement) return;
    
    switch (output.agreement) {
      case 'agree':
        this.state.consensus.agree++;
        break;
      case 'disagree':
        this.state.consensus.disagree++;
        break;
      case 'neutral':
      default:
        this.state.consensus.neutral++;
        break;
    }
  }
  
  /**
   * Calculate correlation between two agent outputs
   */
  calculateCorrelation(agent1Role, agent2Role) {
    const pairKey = `${agent1Role}-${agent2Role}`;
    const reverseKey = `${agent2Role}-${agent1Role}`;
    
    // Check both orderings
    const coefficient = this.entanglementCoefficients[pairKey] 
      || this.entanglementCoefficients[reverseKey]
      || 0.5; // default correlation
    
    const output1 = this.state[this.getOutputKey(agent1Role)];
    const output2 = this.state[this.getOutputKey(agent2Role)];
    
    if (!output1 || !output2) return 0;
    
    // Calculate correlation score based on:
    // 1. Agreement in decisions
    // 2. Complementary insights
    // 3. Risk alignment
    
    let correlation = coefficient;
    
    // Boost if agents agree on decisions
    if (output1.decision && output2.decision) {
      if (output1.decision === output2.decision) {
        correlation *= 1.2; // Agreement boost
      } else {
        correlation *= 0.8; // Disagreement penalty
      }
    }
    
    // Boost if insights complement each other
    if (output1.insights?.length > 0 && output2.insights?.length > 0) {
      correlation *= 1.1;
    }
    
    return Math.min(1, Math.max(0, correlation));
  }
  
  /**
   * Get entangled state summary for debugging
   */
  getEntanglementSummary() {
    const correlations = [];
    for (const [pair, coefficient] of Object.entries(this.entanglementCoefficients)) {
      correlations.push({ pair, coefficient });
    }
    
    return {
      agents: Object.keys(this.state).filter(k => 
        k !== 'task' && k !== 'taskType' && k !== 'correlations' 
        && k !== 'insights' && k !== 'risks' && k !== 'decisions' && k !== 'consensus'
      ).filter(k => this.state[k] !== null),
      insights: this.state.insights.length,
      risks: this.state.risks.length,
      decisions: this.state.decisions.length,
      consensus: this.state.consensus,
      correlations
    };
  }
}

// ============================================================================
// Entangled Agent
// ============================================================================

class EntangledAgent {
  constructor(role, options = {}) {
    this.role = role;
    this.model = options.model || null;
    this.tools = options.tools || [];
    this.temperature = options.temperature || 0.2;
    
    // Agent's own state
    this.output = null;
    this.processingTime = 0;
    this.tokensUsed = 0;
    this.error = null;
    
    // Entanglement settings
    this.influenceWeight = options.influenceWeight || 1.0; // How much this agent influences others
    this.sensitivityToOthers = options.sensitivityToOthers || 0.5; // How much this agent is influenced by others
  }
  
  /**
   * Build the agent's prompt with entangled context
   */
  buildEntangledPrompt(sharedState, rolePrompt) {
    const otherOutputs = sharedState.readState(this.role);
    
    // Build entangled context from other agents' outputs
    const entangledContext = [];
    
    if (otherOutputs.plan) {
      entangledContext.push(`[Planner-ın planı]: ${JSON.stringify(otherOutputs.plan).slice(0, 1000)}`);
    }
    if (otherOutputs.implementation) {
      entangledContext.push(`[Builder-ın işi]: ${JSON.stringify(otherOutputs.implementation).slice(0, 1000)}`);
    }
    if (otherOutputs.review) {
      entangledContext.push(`[Reviewer-ın rəyi]: ${JSON.stringify(otherOutputs.review).slice(0, 1000)}`);
    }
    if (otherOutputs.security) {
      entangledContext.push(`[Security tapıntıları]: ${JSON.stringify(otherOutputs.security).slice(0, 1000)}`);
    }
    if (otherOutputs.qa) {
      entangledContext.push(`[QA nəticələri]: ${JSON.stringify(otherOutputs.qa).slice(0, 1000)}`);
    }
    if (otherOutputs.architecture) {
      entangledContext.push(`[Architect dizaynı]: ${JSON.stringify(otherOutputs.architecture).slice(0, 1000)}`);
    }
    
    // Add shared insights
    if (otherOutputs.insights.length > 0) {
      entangledContext.push(`[Digər agent-lərin insight-ları]: ${otherOutputs.insights.slice(-5).join('\n')}`);
    }
    
    // Add shared risks
    if (otherOutputs.risks.length > 0) {
      entangledContext.push(`[Digər agent-lərin risk bayraqları]: ${otherOutputs.risks.slice(-3).join('\n')}`);
    }
    
    // Add consensus info
    const { agree, disagree, neutral } = otherOutputs.consensus;
    if (agree + disagree + neutral > 0) {
      entangledContext.push(`[Konsensus]: ${agree} razı, ${disagree} razı deyil, ${neutral} neytral`);
    }
    
    // Build final prompt
    const parts = [
      rolePrompt,
      '',
      '--- Quantum Entanglement Context ---',
      'Sən indi parallel rejimdə digər agent-lərlə birlikdə işləyirsən.',
      'Digər agent-lərin output-ları aşağıda göstərilir. Onları nəzərə al:',
      '',
      ...entangledContext,
      '',
      '--- Output Formatı ---',
      'Cavabında bu formatı istifadə et:',
      '1. `content`: Əsas nəticə/icra',
      '2. `decision`: qərar (approve/reject/modify/abstain)',
      '3. `confidence`: 0-1 arası etibarlılıq',
      '4. `agreement`: agree/disagree/neutral (digər agent-lərlə razılaşma)',
      '5. `insights`: [string array] — digər agent-lər üçün insight-lar',
      '6. `risks`: [string array] — aşkar etdiyin risklər',
      '7. `correlation_note`: digər agent output-larına qısa şərh'
    ];
    
    return parts.join('\n');
  }
  
  /**
   * Process agent output and extract structured result
   */
  processOutput(rawOutput) {
    if (!rawOutput) return null;
    
    // Try to extract structured output
    try {
      // Look for JSON in the output
      const jsonMatch = rawOutput.match(/\{[\s\S]*"content"[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          content: parsed.content || rawOutput,
          decision: parsed.decision || 'neutral',
          confidence: parsed.confidence || 0.5,
          agreement: parsed.agreement || 'neutral',
          insights: parsed.insights || [],
          risks: parsed.risks || [],
          correlationNote: parsed.correlation_note || '',
          rawOutput
        };
      }
    } catch {
      // JSON parse failed, use raw output
    }
    
    // Fallback: extract from natural language
    return {
      content: rawOutput,
      decision: this.extractDecision(rawOutput),
      confidence: this.extractConfidence(rawOutput),
      agreement: this.extractAgreement(rawOutput),
      insights: this.extractInsights(rawOutput),
      risks: this.extractRisks(rawOutput),
      correlationNote: '',
      rawOutput
    };
  }
  
  /**
   * Extract decision from natural language output
   */
  extractDecision(text) {
    const lower = text.toLowerCase();
    if (/(?:approve|təsdiq|razıyam|correct|düzgündür)/i.test(lower)) return 'approve';
    if (/(?:reject|rədd|qəbul etmirəm|wrong|yanlış|xətalı)/i.test(lower)) return 'reject';
    if (/(?:modify|dəyişiklik|əlavə et|təkmilləşdir)/i.test(lower)) return 'modify';
    return 'neutral';
  }
  
  /**
   * Extract confidence from text
   */
  extractConfidence(text) {
    const lower = text.toLowerCase();
    if (/(?:əmin|tam|kəskin|aydın|clearly|definitely|certainly)/i.test(lower)) return 0.9;
    if (/(?:yüksək|good|yaxşı|etibarlı)/i.test(lower)) return 0.7;
    if (/(?:orta|mixed|qarışiq|bəzən)/i.test(lower)) return 0.5;
    if (/(?:aşağı|low|zəif|şübhə)/i.test(lower)) return 0.3;
    return 0.5;
  }
  
  /**
   * Extract agreement from text
   */
  extractAgreement(text) {
    const lower = text.toLowerCase();
    if (/(?:razıyam|agree|consensus|uyğun|match)/i.test(lower)) return 'agree';
    if (/(?:razı deyil|disagree|conflict|fərqli|different)/i.test(lower)) return 'disagree';
    return 'neutral';
  }
  
  /**
   * Extract insights from text
   */
  extractInsights(text) {
    const insights = [];
    const lines = text.split('\n');
    for (const line of lines) {
      if (/(?:insight|qeyd|əlavə|note|important|vacib)/i.test(line)) {
        insights.push(line.trim());
      }
    }
    return insights.slice(0, 3); // Max 3 insights per agent
  }
  
  /**
   * Extract risks from text
   */
  extractRisks(text) {
    const risks = [];
    const lines = text.split('\n');
    for (const line of lines) {
      if (/(?:risk|xəta|təhlükə|warning|diqqət|caution)/i.test(line)) {
        risks.push(line.trim());
      }
    }
    return risks.slice(0, 3); // Max 3 risks per agent
  }
}

// ============================================================================
// Quantum Entanglement Engine
// ============================================================================

class QuantumEntanglementEngine {
  constructor(options = {}) {
    this.maxParallelAgents = options.maxParallelAgents || 4;
    this.correlationThreshold = options.correlationThreshold || 0.3;
    this.consensusThreshold = options.consensusThreshold || 0.6;
    this.enableQuantumInterference = options.enableQuantumInterference !== false;
  }
  
  /**
   * Run entangled execution: all agents think in parallel
   */
  async entangledExecution(agents, sharedState, taskPrompt) {
    const startTime = Date.now();
    
    // Phase 1: Superposition — all agents think simultaneously
    const thinkingPromises = agents.map(async (agent) => {
      const agentStart = Date.now();
      
      try {
        // Build entangled prompt with shared context
        const entangledPrompt = agent.buildEntangledPrompt(sharedState, taskPrompt);
        
        // Agent thinks (this is where LLM call would happen)
        // For now, we simulate with a placeholder
        const output = await this.callAgent(agent, entangledPrompt);
        
        // Process and structure the output
        const processedOutput = agent.processOutput(output);
        
        // Write to shared state (entanglement)
        sharedState.writeAgentOutput(agent.role, processedOutput);
        
        agent.output = processedOutput;
        agent.processingTime = Date.now() - agentStart;
        
        return {
          role: agent.role,
          output: processedOutput,
          processingTime: agent.processingTime,
          error: null
        };
      } catch (err) {
        agent.error = err.message;
        agent.processingTime = Date.now() - agentStart;
        
        return {
          role: agent.role,
          output: null,
          processingTime: agent.processingTime,
          error: err.message
        };
      }
    });
    
    // Wait for all agents to finish (with timeout)
    const results = await Promise.allSettled(thinkingPromises);
    
    // Phase 2: Correlation — calculate how agents influenced each other
    const correlations = this.calculateAllCorrelations(agents, sharedState);
    
    // Phase 3: Quantum Interference — conflicting outputs cancel, agreeing amplify
    const interferedOutputs = this.quantumInterference(agents, sharedState, correlations);
    
    // Phase 4: Collapse — merge all outputs into unified decision
    const collapsedResult = this.collapseWaveFunction(interferedOutputs, sharedState);
    
    const totalTime = Date.now() - startTime;
    
    return {
      result: collapsedResult,
      correlations,
      agentResults: results.map(r => r.status === 'fulfilled' ? r.value : r.reason),
      entanglementSummary: sharedState.getEntanglementSummary(),
      totalTime,
      parallelSpeedup: this.calculateSpeedup(agents, totalTime)
    };
  }
  
  /**
   * Call agent with prompt (placeholder for actual LLM call)
   */
  async callAgent(agent, prompt) {
    // This is a placeholder. In production, this would call the LLM.
    // The actual implementation would be injected via dependencies.
    
    // For now, return a structured placeholder
    return `[${agent.role}] Analiz etdim. Task: ${prompt.slice(0, 200)}...`;
  }
  
  /**
   * Calculate correlations between all agent pairs
   */
  calculateAllCorrelations(agents, sharedState) {
    const correlations = [];
    
    for (let i = 0; i < agents.length; i++) {
      for (let j = i + 1; j < agents.length; j++) {
        const correlation = sharedState.calculateCorrelation(agents[i].role, agents[j].role);
        correlations.push({
          agent1: agents[i].role,
          agent2: agents[j].role,
          correlation,
          entangled: correlation > this.correlationThreshold
        });
      }
    }
    
    return correlations;
  }
  
  /**
   * Quantum Interference: conflicting outputs cancel, agreeing amplify
   */
  quantumInterference(agents, sharedState, correlations) {
    if (!this.enableQuantumInterference) {
      return agents.map(a => ({
        role: a.role,
        output: a.output,
        weight: 1.0
      }));
    }
    
    const outputs = [];
    
    for (const agent of agents) {
      if (!agent.output) continue;
      
      // Start with base weight
      let weight = agent.influenceWeight;
      
      // Find correlations involving this agent
      for (const corr of correlations) {
        if (corr.agent1 === agent.role || corr.agent2 === agent.role) {
          const otherRole = corr.agent1 === agent.role ? corr.agent2 : corr.agent1;
          const otherAgent = agents.find(a => a.role === otherRole);
          
          if (otherAgent?.output) {
            // If agents agree, boost both weights
            if (agent.output.agreement === 'agree' && otherAgent.output.agreement === 'agree') {
              weight *= 1 + (corr.correlation * 0.2);
            }
            // If agents disagree, reduce both weights
            else if (agent.output.agreement === 'disagree' || otherAgent.output.agreement === 'disagree') {
              weight *= 1 - (corr.correlation * 0.1);
            }
          }
        }
      }
      
      outputs.push({
        role: agent.role,
        output: agent.output,
        weight: Math.max(0.1, Math.min(2.0, weight)) // Clamp weight
      });
    }
    
    return outputs;
  }
  
  /**
   * Wave Function Collapse: merge all outputs into unified decision
   */
  collapseWaveFunction(interferedOutputs, sharedState) {
    if (interferedOutputs.length === 0) {
      return {
        decision: 'abstain',
        content: 'Heç bir agent output vermədi.',
        confidence: 0,
        consensus: 'none'
      };
    }
    
    // Group outputs by decision
    const byDecision = {};
    let totalWeight = 0;
    
    for (const { role, output, weight } of interferedOutputs) {
      if (!output) continue;
      
      const decision = output.decision || 'neutral';
      if (!byDecision[decision]) {
        byDecision[decision] = { outputs: [], totalWeight: 0, roles: [] };
      }
      byDecision[decision].outputs.push(output);
      byDecision[decision].totalWeight += weight;
      byDecision[decision].roles.push(role);
      totalWeight += weight;
    }
    
    // Find the decision with highest weighted support
    let maxWeight = 0;
    let winningDecision = 'neutral';
    let winningOutputs = [];
    
    for (const [decision, data] of Object.entries(byDecision)) {
      if (data.totalWeight > maxWeight) {
        maxWeight = data.totalWeight;
        winningDecision = decision;
        winningOutputs = data.outputs;
      }
    }
    
    // Calculate consensus score
    const consensusScore = totalWeight > 0 ? maxWeight / totalWeight : 0;
    const consensus = consensusScore >= this.consensusThreshold ? 'strong' 
      : consensusScore >= 0.4 ? 'moderate' 
      : 'weak';
    
    // Merge content from winning outputs
    const mergedContent = winningOutputs
      .map(o => o.content)
      .filter(Boolean)
      .join('\n\n---\n\n');
    
    // Merge all insights and risks
    const allInsights = [];
    const allRisks = [];
    for (const { output } of interferedOutputs) {
      if (output?.insights) allInsights.push(...output.insights);
      if (output?.risks) allRisks.push(...output.risks);
    }
    
    // Calculate average confidence
    const avgConfidence = interferedOutputs.reduce((sum, { output, weight }) => 
      sum + (output?.confidence || 0.5) * weight, 0
    ) / (totalWeight || 1);
    
    return {
      decision: winningDecision,
      content: mergedContent,
      confidence: avgConfidence,
      consensus,
      consensusScore,
      insights: [...new Set(allInsights)].slice(0, 10), // Dedupe, max 10
      risks: [...new Set(allRisks)].slice(0, 10),
      agentContributions: interferedOutputs.map(({ role, weight }) => ({
        role,
        weight,
        contributed: !!interferedOutputs.find(o => o.role === role)?.output
      }))
    };
  }
  
  /**
   * Calculate speedup compared to serial execution
   */
  calculateSpeedup(agents, parallelTime) {
    // Estimate serial time as sum of all agent times
    const serialTime = agents.reduce((sum, agent) => sum + (agent.processingTime || 1000), 0);
    
    return {
      parallelTime,
      estimatedSerialTime: serialTime,
      speedupFactor: serialTime > 0 ? (serialTime / parallelTime).toFixed(2) : 'N/A'
    };
  }
}

// ============================================================================
// Quantum Entangled Agents (Main Interface)
// ============================================================================

class QuantumEntangledAgents {
  constructor(options = {}) {
    this.engine = new QuantumEntanglementEngine(options);
    this.agents = new Map();
    this.sharedState = null;
    this.history = [];
  }
  
  /**
   * Register agents for entangled execution
   */
  registerAgents(agentConfigs) {
    for (const config of agentConfigs) {
      const agent = new EntangledAgent(config.role, config);
      this.agents.set(config.role, agent);
    }
  }
  
  /**
   * Execute task with entangled agents
   */
  async executeEntangled(task, taskPrompt, options = {}) {
    // Create shared quantum state
    this.sharedState = new SharedQuantumState({
      task,
      taskType: options.taskType || 'general'
    });
    
    // Get agents to execute
    const agentRoles = options.agentRoles || Array.from(this.agents.keys());
    const agents = agentRoles
      .map(role => this.agents.get(role))
      .filter(Boolean);
    
    if (agents.length === 0) {
      throw new Error('No agents registered for entangled execution');
    }
    
    // Execute with quantum entanglement
    const result = await this.engine.entangledExecution(agents, this.sharedState, taskPrompt);
    
    // Store in history
    this.history.push({
      timestamp: Date.now(),
      task,
      agentRoles,
      result: result.result,
      totalTime: result.totalTime,
      parallelSpeedup: result.parallelSpeedup
    });
    
    return result;
  }
  
  /**
   * Get execution history
   */
  getHistory() {
    return this.history;
  }
  
  /**
   * Get current shared state
   */
  getSharedState() {
    return this.sharedState?.getEntanglementSummary() || null;
  }
  
  /**
   * Reset all agents
   */
  reset() {
    for (const [, agent] of this.agents) {
      agent.output = null;
      agent.processingTime = 0;
      agent.tokensUsed = 0;
      agent.error = null;
    }
    this.sharedState = null;
  }
}

// ============================================================================
// Integration with existing orchestrator
// ============================================================================

/**
 * Create entangled agents from workflow configuration
 * This is the bridge between the existing orchestrator and quantum entanglement
 */
function createEntangledAgentsFromWorkflow(workflow, options = {}) {
  const agentConfigs = {
    'default': [
      { role: 'Planner', influenceWeight: 1.0, sensitivityToOthers: 0.3 },
      { role: 'Builder', influenceWeight: 1.2, sensitivityToOthers: 0.7 },
      { role: 'Reviewer', influenceWeight: 1.0, sensitivityToOthers: 0.8 }
    ],
    'thorough': [
      { role: 'Architect', influenceWeight: 1.0, sensitivityToOthers: 0.2 },
      { role: 'Builder', influenceWeight: 1.2, sensitivityToOthers: 0.8 },
      { role: 'Security', influenceWeight: 0.8, sensitivityToOthers: 0.6 },
      { role: 'QA', influenceWeight: 0.9, sensitivityToOthers: 0.7 }
    ],
    'seo_gui': [
      { role: 'Marketing SEO Specialist', influenceWeight: 1.0, sensitivityToOthers: 0.4 },
      { role: 'GUI Operator', influenceWeight: 1.1, sensitivityToOthers: 0.7 },
      { role: 'Reviewer', influenceWeight: 0.9, sensitivityToOthers: 0.8 }
    ],
    'review-only': [
      { role: 'Reviewer', influenceWeight: 1.0, sensitivityToOthers: 0.3 },
      { role: 'Security', influenceWeight: 1.0, sensitivityToOthers: 0.5 }
    ]
  };
  
  const configs = agentConfigs[workflow] || agentConfigs['default'];
  
  const engine = new QuantumEntangledAgents(options);
  engine.registerAgents(configs);
  
  return engine;
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  SharedQuantumState,
  EntangledAgent,
  QuantumEntanglementEngine,
  QuantumEntangledAgents,
  createEntangledAgentsFromWorkflow
};
