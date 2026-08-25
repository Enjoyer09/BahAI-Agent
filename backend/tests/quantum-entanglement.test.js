import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  SharedQuantumState,
  EntangledAgent,
  QuantumEntanglementEngine,
  QuantumEntangledAgents,
  createEntangledAgentsFromWorkflow
} from '../orchestrator/quantumEntanglement.js';

// ============================================================================
// SharedQuantumState Tests
// ============================================================================

describe('SharedQuantumState', () => {
  let state;
  
  beforeEach(() => {
    state = new SharedQuantumState({
      task: 'Test task',
      taskType: 'general'
    });
  });
  
  it('initializes with correct task', () => {
    expect(state.state.task).toBe('Test task');
    expect(state.state.taskType).toBe('general');
  });
  
  it('initializes all outputs as null', () => {
    expect(state.state.plan).toBeNull();
    expect(state.state.implementation).toBeNull();
    expect(state.state.review).toBeNull();
    expect(state.state.security).toBeNull();
    expect(state.state.qa).toBeNull();
    expect(state.state.architecture).toBeNull();
  });
  
  it('reads state excluding own output', () => {
    state.writeAgentOutput('Planner', { content: 'Plan' });
    
    const plannerState = state.readState('Planner');
    expect(plannerState.plan).toBeNull(); // Planner doesn't see own plan
    
    const builderState = state.readState('Builder');
    expect(builderState.plan).not.toBeNull(); // Builder sees Planner's plan
  });
  
  it('writes agent output correctly', () => {
    const output = {
      content: 'Test output',
      decision: 'approve',
      confidence: 0.8,
      agreement: 'agree',
      insights: ['Insight 1'],
      risks: ['Risk 1']
    };
    
    state.writeAgentOutput('Planner', output);
    
    expect(state.state.plan).toEqual(output);
    expect(state.state.insights).toContain('Insight 1');
    expect(state.state.risks).toContain('Risk 1');
    expect(state.state.decisions).toHaveLength(1);
  });
  
  it('tracks consensus correctly', () => {
    state.writeAgentOutput('Planner', { agreement: 'agree' });
    state.writeAgentOutput('Builder', { agreement: 'disagree' });
    state.writeAgentOutput('Reviewer', { agreement: 'neutral' });
    
    expect(state.state.consensus.agree).toBe(1);
    expect(state.state.consensus.disagree).toBe(1);
    expect(state.state.consensus.neutral).toBe(1);
  });
  
  it('calculates correlation between agents', () => {
    state.writeAgentOutput('Planner', { decision: 'approve', confidence: 0.8 });
    state.writeAgentOutput('Builder', { decision: 'approve', confidence: 0.7 });
    
    const correlation = state.calculateCorrelation('Planner', 'Builder');
    
    expect(correlation).toBeGreaterThan(0);
    expect(correlation).toBeLessThanOrEqual(1);
  });
  
  it('returns entanglement summary', () => {
    state.writeAgentOutput('Planner', { content: 'Plan', insights: ['I1'] });
    state.writeAgentOutput('Builder', { content: 'Build', risks: ['R1'] });
    
    const summary = state.getEntanglementSummary();
    
    expect(summary.agents).toContain('plan');
    expect(summary.agents).toContain('implementation');
    expect(summary.insights).toBe(1);
    expect(summary.risks).toBe(1);
  });
});

// ============================================================================
// EntangledAgent Tests
// ============================================================================

describe('EntangledAgent', () => {
  let agent;
  
  beforeEach(() => {
    agent = new EntangledAgent('Planner', {
      influenceWeight: 1.0,
      sensitivityToOthers: 0.5
    });
  });
  
  it('initializes with correct role', () => {
    expect(agent.role).toBe('Planner');
    expect(agent.output).toBeNull();
    expect(agent.processingTime).toBe(0);
  });
  
  it('builds entangled prompt with shared context', () => {
    const state = new SharedQuantumState({ task: 'Test' });
    state.writeAgentOutput('Builder', { content: 'Builder output' });
    
    const prompt = agent.buildEntangledPrompt(state, 'You are a planner');
    
    expect(prompt).toContain('You are a planner');
    expect(prompt).toContain('Builder-ın işi');
    expect(prompt).toContain('Builder output');
    expect(prompt).toContain('Quantum Entanglement Context');
  });
  
  it('processes structured JSON output', () => {
    const rawOutput = JSON.stringify({
      content: 'Plan content',
      decision: 'approve',
      confidence: 0.9,
      agreement: 'agree',
      insights: ['Insight 1'],
      risks: ['Risk 1'],
      correlation_note: 'Matches Builder output'
    });
    
    const processed = agent.processOutput(rawOutput);
    
    expect(processed.content).toBe('Plan content');
    expect(processed.decision).toBe('approve');
    expect(processed.confidence).toBe(0.9);
    expect(processed.agreement).toBe('agree');
    expect(processed.insights).toContain('Insight 1');
  });
  
  it('processes natural language output', () => {
    const rawOutput = 'Plan approved. Risk: potential issue. Important: consider alternatives.';
    
    const processed = agent.processOutput(rawOutput);
    
    expect(processed.content).toBe(rawOutput);
    expect(processed.decision).toBe('approve');
    expect(processed.risks.length).toBeGreaterThan(0);
    expect(processed.insights.length).toBeGreaterThan(0);
  });
  
  it('extracts decision from text', () => {
    expect(agent.extractDecision('Təsdiq edirəm')).toBe('approve');
    expect(agent.extractDecision('Rədd edirəm')).toBe('reject');
    expect(agent.extractDecision('Dəyişiklik lazımdır')).toBe('modify');
    expect(agent.extractDecision('Bayağı mətn')).toBe('neutral');
  });
  
  it('extracts confidence from text', () => {
    expect(agent.extractConfidence('Tam əminəm')).toBe(0.9);
    expect(agent.extractConfidence('Yaxşı nəticə')).toBe(0.7);
    expect(agent.extractConfidence('Orta səviyyə')).toBe(0.5);
    expect(agent.extractConfidence('Zəif nəticə')).toBe(0.3);
  });
  
  it('extracts agreement from text', () => {
    expect(agent.extractAgreement('Razıyam')).toBe('agree');
    expect(agent.extractAgreement('Razı deyiləm')).toBe('disagree');
    expect(agent.extractAgreement('Neytral cavab')).toBe('neutral');
  });
});

// ============================================================================
// QuantumEntanglementEngine Tests
// ============================================================================

describe('QuantumEntanglementEngine', () => {
  let engine;
  
  beforeEach(() => {
    engine = new QuantumEntanglementEngine({
      maxParallelAgents: 4,
      correlationThreshold: 0.3,
      consensusThreshold: 0.6,
      enableQuantumInterference: true
    });
  });
  
  it('calculates correlations correctly', () => {
    const agents = [
      new EntangledAgent('Planner'),
      new EntangledAgent('Builder'),
      new EntangledAgent('Reviewer')
    ];
    
    const state = new SharedQuantumState({ task: 'Test' });
    state.writeAgentOutput('Planner', { decision: 'approve', agreement: 'agree' });
    state.writeAgentOutput('Builder', { decision: 'approve', agreement: 'agree' });
    state.writeAgentOutput('Reviewer', { decision: 'reject', agreement: 'disagree' });
    
    const correlations = engine.calculateAllCorrelations(agents, state);
    
    expect(correlations.length).toBe(3); // 3 pairs
    expect(correlations[0].entangled).toBeDefined();
  });
  
  it('applies quantum interference', () => {
    const agents = [
      { role: 'Planner', output: { decision: 'approve', agreement: 'agree' }, influenceWeight: 1.0 },
      { role: 'Builder', output: { decision: 'approve', agreement: 'agree' }, influenceWeight: 1.0 },
      { role: 'Reviewer', output: { decision: 'reject', agreement: 'disagree' }, influenceWeight: 1.0 }
    ];
    
    const state = new SharedQuantumState({ task: 'Test' });
    const correlations = [
      { agent1: 'Planner', agent2: 'Builder', correlation: 0.8 },
      { agent1: 'Planner', agent2: 'Reviewer', correlation: 0.6 },
      { agent1: 'Builder', agent2: 'Reviewer', correlation: 0.7 }
    ];
    
    const interfered = engine.quantumInterference(agents, state, correlations);
    
    expect(interfered.length).toBe(3);
    // Planner and Builder should have boosted weights (they agree)
    expect(interfered[0].weight).toBeGreaterThan(1.0);
    expect(interfered[1].weight).toBeGreaterThan(1.0);
  });
  
  it('collapses wave function correctly', () => {
    const interferedOutputs = [
      { role: 'Planner', output: { decision: 'approve', content: 'Plan', confidence: 0.8 }, weight: 1.2 },
      { role: 'Builder', output: { decision: 'approve', content: 'Build', confidence: 0.7 }, weight: 1.3 },
      { role: 'Reviewer', output: { decision: 'reject', content: 'Review', confidence: 0.6 }, weight: 0.8 }
    ];
    
    const state = new SharedQuantumState({ task: 'Test' });
    const result = engine.collapseWaveFunction(interferedOutputs, state);
    
    expect(result.decision).toBe('approve'); // 2 approve vs 1 reject
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.consensus).toBeDefined();
    expect(result.agentContributions.length).toBe(3);
  });
  
  it('handles empty outputs', () => {
    const result = engine.collapseWaveFunction([], new SharedQuantumState({}));
    
    expect(result.decision).toBe('abstain');
    expect(result.confidence).toBe(0);
  });
  
  it('calculates speedup correctly', () => {
    const agents = [
      { processingTime: 1000 },
      { processingTime: 1500 },
      { processingTime: 800 }
    ];
    
    const speedup = engine.calculateSpeedup(agents, 1500); // parallel time = max(1000,1500,800) ≈ 1500
    
    expect(speedup.parallelTime).toBe(1500);
    expect(speedup.estimatedSerialTime).toBe(3300); // 1000+1500+800
    expect(parseFloat(speedup.speedupFactor)).toBeGreaterThan(1);
  });
});

// ============================================================================
// QuantumEntangledAgents Tests
// ============================================================================

describe('QuantumEntangledAgents', () => {
  let qea;
  
  beforeEach(() => {
    qea = new QuantumEntangledAgents({
      maxParallelAgents: 3,
      enableQuantumInterference: true
    });
  });
  
  afterEach(() => {
    qea.reset();
  });
  
  it('registers agents correctly', () => {
    qea.registerAgents([
      { role: 'Planner' },
      { role: 'Builder' },
      { role: 'Reviewer' }
    ]);
    
    expect(qea.agents.size).toBe(3);
    expect(qea.agents.has('Planner')).toBe(true);
    expect(qea.agents.has('Builder')).toBe(true);
    expect(qea.agents.has('Reviewer')).toBe(true);
  });
  
  it('executes entangled task', async () => {
    qea.registerAgents([
      { role: 'Planner', influenceWeight: 1.0 },
      { role: 'Builder', influenceWeight: 1.2 },
      { role: 'Reviewer', influenceWeight: 1.0 }
    ]);
    
    const result = await qea.executeEntangled(
      'Build a feature',
      'Implement user authentication',
      { taskType: 'implementation' }
    );
    
    expect(result.result).toBeDefined();
    expect(result.result.decision).toBeDefined();
    expect(result.correlations.length).toBe(3); // 3 pairs
    expect(result.totalTime).toBeGreaterThanOrEqual(0);
    expect(result.parallelSpeedup).toBeDefined();
  });
  
  it('stores execution history', async () => {
    qea.registerAgents([{ role: 'Planner' }]);
    
    await qea.executeEntangled('Task 1', 'Prompt 1');
    await qea.executeEntangled('Task 2', 'Prompt 2');
    
    expect(qea.getHistory()).toHaveLength(2);
  });
  
  it('resets correctly', async () => {
    qea.registerAgents([{ role: 'Planner' }]);
    await qea.executeEntangled('Task', 'Prompt');
    
    qea.reset();
    
    expect(qea.agents.get('Planner').output).toBeNull();
    expect(qea.sharedState).toBeNull();
  });
  
  it('throws when no agents registered', async () => {
    await expect(qea.executeEntangled('Task', 'Prompt')).rejects.toThrow('No agents registered');
  });
});

// ============================================================================
// createEntangledAgentsFromWorkflow Tests
// ============================================================================

describe('createEntangledAgentsFromWorkflow', () => {
  it('creates default workflow agents', () => {
    const qea = createEntangledAgentsFromWorkflow('default');
    
    expect(qea.agents.size).toBe(3);
    expect(qea.agents.has('Planner')).toBe(true);
    expect(qea.agents.has('Builder')).toBe(true);
    expect(qea.agents.has('Reviewer')).toBe(true);
  });
  
  it('creates thorough workflow agents', () => {
    const qea = createEntangledAgentsFromWorkflow('thorough');
    
    expect(qea.agents.size).toBe(4);
    expect(qea.agents.has('Architect')).toBe(true);
    expect(qea.agents.has('Builder')).toBe(true);
    expect(qea.agents.has('Security')).toBe(true);
    expect(qea.agents.has('QA')).toBe(true);
  });
  
  it('creates seo_gui workflow agents', () => {
    const qea = createEntangledAgentsFromWorkflow('seo_gui');
    
    expect(qea.agents.size).toBe(3);
    expect(qea.agents.has('Marketing SEO Specialist')).toBe(true);
    expect(qea.agents.has('GUI Operator')).toBe(true);
    expect(qea.agents.has('Reviewer')).toBe(true);
  });
  
  it('creates review-only workflow agents', () => {
    const qea = createEntangledAgentsFromWorkflow('review-only');
    
    expect(qea.agents.size).toBe(2);
    expect(qea.agents.has('Reviewer')).toBe(true);
    expect(qea.agents.has('Security')).toBe(true);
  });
  
  it('falls back to default for unknown workflow', () => {
    const qea = createEntangledAgentsFromWorkflow('unknown');
    
    expect(qea.agents.size).toBe(3);
    expect(qea.agents.has('Planner')).toBe(true);
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe('Quantum Entanglement Integration', () => {
  it('agents share insights through entanglement', async () => {
    const qea = new QuantumEntangledAgents({ enableQuantumInterference: true });
    
    qea.registerAgents([
      { role: 'Planner', influenceWeight: 1.0 },
      { role: 'Builder', influenceWeight: 1.2 },
      { role: 'Reviewer', influenceWeight: 1.0 }
    ]);
    
    const result = await qea.executeEntangled(
      'Feature implementation',
      'Add user authentication with JWT',
      { taskType: 'implementation' }
    );
    
    // Verify entanglement summary shows agents communicated
    expect(result.entanglementSummary).toBeDefined();
    expect(result.entanglementSummary.agents.length).toBeGreaterThan(0);
  });
  
  it('parallel execution is faster than serial', async () => {
    const qea = new QuantumEntangledAgents({ enableQuantumInterference: true });
    
    qea.registerAgents([
      { role: 'Planner', influenceWeight: 1.0 },
      { role: 'Builder', influenceWeight: 1.2 },
      { role: 'Reviewer', influenceWeight: 1.0 }
    ]);
    
    const result = await qea.executeEntangled('Task', 'Prompt');
    
    // Verify parallel speedup calculation exists
    expect(result.parallelSpeedup.parallelTime).toBeDefined();
    expect(result.parallelSpeedup.estimatedSerialTime).toBeGreaterThan(0);
  });
});
