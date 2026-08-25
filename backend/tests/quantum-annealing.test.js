import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  Solution,
  EnergyFunction,
  NeighborGenerator,
  QuantumAnnealingOptimizer,
  quantumOptimizeRouting,
  DEFAULT_CONFIG
} from '../orchestrator/quantumAnnealing.js';

// ============================================================================
// Solution Tests
// ============================================================================

describe('Solution', () => {
  it('initializes with default values', () => {
    const sol = new Solution();
    expect(sol.workflow).toBe('default');
    expect(sol.agents).toEqual(['Planner', 'Builder', 'Reviewer']);
    expect(sol.resources.maxSteps).toBe(5);
  });
  
  it('initializes with custom values', () => {
    const sol = new Solution({
      workflow: 'quick',
      agents: ['Implementer'],
      resources: { maxSteps: 4, agentCount: 1, allowTools: true, preferDirect: true }
    });
    expect(sol.workflow).toBe('quick');
    expect(sol.agents).toEqual(['Implementer']);
    expect(sol.resources.maxSteps).toBe(4);
  });
  
  it('clones correctly', () => {
    const sol = new Solution({ workflow: 'gui', agents: ['Planner', 'Builder'] });
    const clone = sol.clone();
    
    expect(clone.workflow).toBe('gui');
    expect(clone.agents).toEqual(['Planner', 'Builder']);
    expect(clone).not.toBe(sol); // Different object
    expect(clone.agents).not.toBe(sol.agents); // Different array
  });
  
  it('converts to routing format', () => {
    const sol = new Solution({
      workflow: 'default',
      agents: ['Planner', 'Builder', 'Reviewer'],
      resources: { maxSteps: 5, agentCount: 3, allowTools: true, preferDirect: false }
    });
    
    const routing = sol.toRoutingFormat();
    
    expect(routing.mode).toBe('delegated');
    expect(routing.primaryAgent).toBe('Planner');
    expect(routing.secondaryAgents).toEqual(['Builder', 'Reviewer']);
    expect(routing.workflow).toBe('default');
    expect(routing.maxSteps).toBe(5);
    expect(routing.tokenDiscipline.agentCount).toBe(3);
  });
  
  it('converts solo agent to direct mode', () => {
    const sol = new Solution({
      workflow: 'quick',
      agents: ['Implementer']
    });
    
    const routing = sol.toRoutingFormat();
    expect(routing.mode).toBe('direct');
    expect(routing.primaryAgent).toBe('Implementer');
    expect(routing.secondaryAgents).toEqual([]);
  });
});

// ============================================================================
// EnergyFunction Tests
// ============================================================================

describe('EnergyFunction', () => {
  let energyFn;
  
  beforeEach(() => {
    energyFn = new EnergyFunction({
      text: 'Add user authentication with JWT',
      taskType: 'implementation'
    });
  });
  
  it('calculates energy for a solution', () => {
    const sol = new Solution({ workflow: 'default', agents: ['Planner', 'Builder', 'Reviewer'] });
    const energy = energyFn.calculateEnergy(sol);
    
    expect(energy).toBeGreaterThanOrEqual(0);
    expect(energy).toBeLessThan(100); // Should not be astronomically high
  });
  
  it('gives lower energy to better matching solutions', () => {
    const goodSol = new Solution({
      workflow: 'default',
      agents: ['Planner', 'Builder', 'Reviewer'],
      resources: { maxSteps: 5, agentCount: 3, allowTools: true, preferDirect: false }
    });
    
    const badSol = new Solution({
      workflow: 'gui',
      agents: ['Computer Use Operator'],
      resources: { maxSteps: 10, agentCount: 1, allowTools: false, preferDirect: true }
    });
    
    energyFn.calculateEnergy(goodSol);
    energyFn.calculateEnergy(badSol);
    
    expect(goodSol.energy).toBeLessThan(badSol.energy);
  });
  
  it('penalizes constraint violations', () => {
    const validSol = new Solution({
      workflow: 'default',
      agents: ['Planner', 'Builder'],
      resources: { maxSteps: 5, agentCount: 2, allowTools: true, preferDirect: false }
    });
    
    const invalidSol = new Solution({
      workflow: 'invalid_workflow',
      agents: [],
      resources: { maxSteps: 15, agentCount: 0, allowTools: true, preferDirect: false }
    });
    
    energyFn.calculateEnergy(validSol);
    energyFn.calculateEnergy(invalidSol);
    
    expect(invalidSol.constraintViolations).toBeGreaterThan(0);
    expect(invalidSol.energy).toBeGreaterThan(validSol.energy);
  });
  
  it('analyzes task requirements correctly', () => {
    const codeFn = new EnergyFunction({ text: 'Implement a REST API' });
    expect(codeFn.taskRequirements.needsCode).toBe(true);
    
    const reviewFn = new EnergyFunction({ text: 'Security audit of the codebase' });
    expect(reviewFn.taskRequirements.needsReview).toBe(true);
    
    const browserFn = new EnergyFunction({ text: 'Open browser and take screenshot' });
    expect(browserFn.taskRequirements.needsBrowser).toBe(true);
  });
});

// ============================================================================
// NeighborGenerator Tests
// ============================================================================

describe('NeighborGenerator', () => {
  let gen;
  
  beforeEach(() => {
    gen = new NeighborGenerator();
  });
  
  it('generates a valid neighbor', () => {
    const sol = new Solution({ workflow: 'default', agents: ['Planner', 'Builder', 'Reviewer'] });
    const neighbor = gen.generateNeighbor(sol, 1.0);
    
    expect(neighbor).toBeDefined();
    expect(neighbor.workflow).toBeDefined();
    expect(Array.isArray(neighbor.agents)).toBe(true);
  });
  
  it('neighbor is different from original (usually)', () => {
    const sol = new Solution({ workflow: 'default', agents: ['Planner', 'Builder', 'Reviewer'] });
    
    // Run multiple times - at least one should be different
    let foundDifferent = false;
    for (let i = 0; i < 10; i++) {
      const neighbor = gen.generateNeighbor(sol, 1.0);
      if (neighbor.workflow !== sol.workflow || 
          neighbor.agents.length !== sol.agents.length) {
        foundDifferent = true;
        break;
      }
    }
    expect(foundDifferent).toBe(true);
  });
  
  it('perturbs workflow correctly', () => {
    const sol = new Solution({ workflow: 'default' });
    gen.perturbWorkflow(sol);
    
    // Should be a valid workflow
    const validWorkflows = ['quick', 'default', 'gui', 'computer_use', 'seo_gui', 'thorough', 'review-only'];
    expect(validWorkflows).toContain(sol.workflow);
  });
  
  it('perturbs agents correctly', () => {
    const sol = new Solution({ workflow: 'default', agents: ['Planner', 'Builder', 'Reviewer'] });
    gen.perturbAgents(sol);
    
    // Agent count should change (or stay same if at boundary)
    expect(sol.agents.length).toBeGreaterThanOrEqual(1);
    expect(sol.agents.length).toBeLessThanOrEqual(5);
  });
  
  it('perturbs resources correctly', () => {
    const sol = new Solution({ resources: { maxSteps: 5 } });
    gen.perturbResources(sol);
    
    expect(sol.resources.maxSteps).toBeGreaterThanOrEqual(1);
    expect(sol.resources.maxSteps).toBeLessThanOrEqual(10);
  });
  
  it('quantum tunnel creates very different solution', () => {
    const sol = new Solution({ workflow: 'default', agents: ['Planner', 'Builder', 'Reviewer'] });
    const tunneled = gen.quantumTunnel(sol.clone());
    
    // Quantum tunnel should potentially change everything
    expect(tunneled.workflow).toBeDefined();
    expect(Array.isArray(tunneled.agents)).toBe(true);
  });
});

// ============================================================================
// QuantumAnnealingOptimizer Tests
// ============================================================================

describe('QuantumAnnealingOptimizer', () => {
  let optimizer;
  
  beforeEach(() => {
    optimizer = new QuantumAnnealingOptimizer({
      maxIterations: 50,
      initialTemperature: 1.0,
      coolingRate: 0.95
    });
  });
  
  it('optimizes and finds a solution', () => {
    const result = optimizer.optimize({
      text: 'Add user authentication with JWT',
      taskType: 'implementation'
    });
    
    expect(result.bestSolution).toBeDefined();
    expect(result.bestEnergy).toBeLessThan(Infinity);
    expect(result.iterations).toBe(50);
    expect(result.history.length).toBe(50);
  });
  
  it('finds better solution than initial', () => {
    const result = optimizer.optimize({
      text: 'Security audit of the codebase',
      taskType: 'audit'
    });
    
    // Best energy should be less than or equal to first iteration
    expect(result.bestEnergy).toBeLessThanOrEqual(result.history[0].currentEnergy);
  });
  
  it('temperature decreases over time', () => {
    const result = optimizer.optimize({ text: 'Test task' });
    
    const firstTemp = result.history[0].temperature;
    const lastTemp = result.history[result.history.length - 1].temperature;
    
    expect(lastTemp).toBeLessThan(firstTemp);
  });
  
  it('creates greedy initial solution', () => {
    const sol = optimizer.greedyInitialSolution({
      text: 'Security audit of the codebase',
      taskType: 'audit'
    });
    
    expect(sol.workflow).toBe('review-only');
    expect(sol.agents).toContain('Reviewer');
  });
  
  it('creates random solution', () => {
    const sol = optimizer.randomSolution();
    
    expect(sol.workflow).toBeDefined();
    expect(Array.isArray(sol.agents)).toBe(true);
    expect(sol.agents.length).toBeGreaterThan(0);
  });
  
  it('provides optimization summary', () => {
    optimizer.optimize({ text: 'Test task' });
    const summary = optimizer.getSummary();
    
    expect(summary.bestWorkflow).toBeDefined();
    expect(summary.bestAgents).toBeDefined();
    expect(summary.bestEnergy).toBeLessThan(Infinity);
    expect(summary.iterations).toBe(50);
  });
  
  it('calculates improvement percentage', () => {
    const result = optimizer.optimize({ text: 'Test task' });
    const improvement = parseFloat(result.improvement);
    
    expect(improvement).toBeGreaterThanOrEqual(0);
  });
  
  it('finds convergence point', () => {
    optimizer.optimize({ text: 'Test task' });
    const convergence = optimizer.findConvergencePoint();
    
    expect(convergence).toBeGreaterThanOrEqual(0);
    expect(convergence).toBeLessThanOrEqual(50);
  });
  
  it('handles different task types', () => {
    const codeResult = optimizer.optimize({ text: 'Implement REST API', taskType: 'implementation' });
    expect(codeResult.bestSolution.workflow).toBeDefined();
    
    const reviewResult = optimizer.optimize({ text: 'Security audit', taskType: 'audit' });
    expect(reviewResult.bestSolution.workflow).toBeDefined();
    
    const browserResult = optimizer.optimize({ text: 'Open browser', taskType: 'browser' });
    expect(browserResult.bestSolution.workflow).toBeDefined();
  });
  
  it('respects initial solution', () => {
    const initial = new Solution({
      workflow: 'quick',
      agents: ['Implementer'],
      resources: { maxSteps: 4, agentCount: 1, allowTools: true, preferDirect: true }
    });
    
    const result = optimizer.optimize({ text: 'Test task' }, { initialSolution: initial });
    
    // Should start from or near the initial solution
    expect(result.bestSolution).toBeDefined();
  });
});

// ============================================================================
// quantumOptimizeRouting Integration Tests
// ============================================================================

describe('quantumOptimizeRouting', () => {
  it('returns routing configuration', () => {
    const result = quantumOptimizeRouting({
      text: 'Add user authentication with JWT',
      taskType: 'implementation'
    });
    
    expect(result).toBeDefined();
    expect(result.routing).toBeDefined();
    expect(result.routing.workflow).toBeDefined();
    expect(result.routing.primaryAgent).toBeDefined();
    expect(result.routing.maxSteps).toBeDefined();
  });
  
  it('returns null when disabled', () => {
    const result = quantumOptimizeRouting(
      { text: 'Test task' },
      { enabled: false }
    );
    
    expect(result).toBeNull();
  });
  
  it('uses current routing as initial solution', () => {
    const currentRouting = {
      workflow: 'gui',
      primaryAgent: 'Planner',
      secondaryAgents: ['Builder', 'Reviewer'],
      maxSteps: 5,
      useTools: true
    };
    
    const result = quantumOptimizeRouting(
      { text: 'Browser automation task' },
      { currentRouting }
    );
    
    expect(result).toBeDefined();
    expect(result.routing).toBeDefined();
  });
  
  it('provides improvement metric', () => {
    const result = quantumOptimizeRouting({
      text: 'Security audit'
    });
    
    expect(result.improvement).toBeDefined();
    expect(parseFloat(result.improvement)).toBeGreaterThanOrEqual(0);
  });
  
  it('provides summary', () => {
    const result = quantumOptimizeRouting({
      text: 'Test task'
    });
    
    expect(result.summary).toBeDefined();
    expect(result.summary.bestWorkflow).toBeDefined();
    expect(result.summary.bestAgents).toBeDefined();
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe('Quantum Annealing Edge Cases', () => {
  it('handles empty task text', () => {
    const optimizer = new QuantumAnnealingOptimizer({ maxIterations: 10 });
    const result = optimizer.optimize({ text: '' });
    
    expect(result.bestSolution).toBeDefined();
    expect(result.bestEnergy).toBeLessThan(Infinity);
  });
  
  it('handles very long task text', () => {
    const optimizer = new QuantumAnnealingOptimizer({ maxIterations: 10 });
    const result = optimizer.optimize({ text: 'A'.repeat(10000) });
    
    expect(result.bestSolution).toBeDefined();
  });
  
  it('handles single iteration', () => {
    const optimizer = new QuantumAnnealingOptimizer({ maxIterations: 1 });
    const result = optimizer.optimize({ text: 'Test' });
    
    expect(result.iterations).toBe(1);
    expect(result.history.length).toBe(1);
  });
  
  it('handles zero temperature', () => {
    const optimizer = new QuantumAnnealingOptimizer({
      maxIterations: 10,
      initialTemperature: 0.001,
      minTemperature: 0.001,
      coolingRate: 0.5
    });
    
    const result = optimizer.optimize({ text: 'Test' });
    expect(result.bestSolution).toBeDefined();
  });
});
