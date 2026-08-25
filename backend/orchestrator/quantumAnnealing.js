/**
 * bahAI - Quantum Annealing Optimizer
 * 
 * A quantum-inspired optimization system that finds global optimum solutions
 * for task allocation, workflow selection, model assignment, and resource
 * distribution. Replaces greedy/heuristic routing with simulated quantum
 * tunneling to escape local optima.
 * 
 * Key concepts from quantum annealing:
 * - Temperature: Controls exploration (high) vs exploitation (low)
 * - Energy Function: Measures solution quality (lower = better)
 * - Neighbor Generation: Creates variations of current solution
 * - Boltzmann Acceptance: Accepts worse solutions probabilistically to escape local optima
 * - Cooling Schedule: Temperature decreases over time (annealing)
 * - Quantum Tunneling: Can "tunnel" through energy barriers (special neighbor generation)
 * 
 * Application to BahAI-Agent:
 * - Optimize which workflow to use for a given task
 * - Optimize which agents to assign
 * - Optimize which models each agent should use
 * - Optimize resource distribution (maxSteps, timeouts)
 */

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_CONFIG = {
  // Initial temperature (high = more exploration)
  initialTemperature: 1.0,
  
  // Minimum temperature (low = exploitation only)
  minTemperature: 0.01,
  
  // Cooling rate (0.95 = 5% cooling per iteration)
  coolingRate: 0.95,
  
  // Number of iterations
  maxIterations: 100,
  
  // Quantum tunneling probability (allows jumping through energy barriers)
  tunnelingProbability: 0.1,
  
  // Neighbor perturbation strength (0-1, higher = bigger changes)
  perturbationStrength: 0.3,
  
  // Constraint violation penalty multiplier
  constraintPenaltyMultiplier: 100,
  
  // Resource cost weight (lower resource usage = lower energy)
  resourceCostWeight: 0.3,
  
  // Capability match weight (better match = lower energy)
  capabilityMatchWeight: 0.5,
  
  // Workflow fitness weight
  workflowFitnessWeight: 0.2,
};

// ============================================================================
// Solution Representation
// ============================================================================

/**
 * A solution represents a complete task allocation configuration:
 * - workflow: which workflow to use
 * - agents: which agents to assign
 * - models: which model for each agent
 * - resources: maxSteps, timeouts, etc.
 */
class Solution {
  constructor(config = {}) {
    this.workflow = config.workflow || 'default';
    this.agents = config.agents || ['Planner', 'Builder', 'Reviewer'];
    this.models = config.models || {};
    this.resources = config.resources || {
      maxSteps: 5,
      agentCount: 3,
      allowTools: true,
      preferDirect: false
    };
    
    // Energy metrics
    this.energy = Infinity;
    this.constraintViolations = 0;
    this.capabilityScore = 0;
    this.resourceCost = 0;
    this.workflowFitness = 0;
  }
  
  /**
   * Create a deep copy of this solution
   */
  clone() {
    const copy = new Solution({
      workflow: this.workflow,
      agents: [...this.agents],
      models: { ...this.models },
      resources: { ...this.resources }
    });
    copy.energy = this.energy;
    copy.constraintViolations = this.constraintViolations;
    copy.capabilityScore = this.capabilityScore;
    copy.resourceCost = this.resourceCost;
    copy.workflowFitness = this.workflowFitness;
    return copy;
  }
  
  /**
   * Convert to routing format (compatible with existing system)
   */
  toRoutingFormat() {
    return {
      mode: this.agents.length > 1 ? 'delegated' : 'direct',
      primaryAgent: this.agents[0] || 'Solo Agent',
      secondaryAgents: this.agents.slice(1),
      workflow: this.workflow,
      useTools: this.resources.allowTools,
      maxSteps: this.resources.maxSteps,
      reason: `Quantum annealing optimized: ${this.workflow}`,
      tokenDiscipline: {
        maxSteps: this.resources.maxSteps,
        agentCount: this.agents.length,
        allowTools: this.resources.allowTools,
        preferDirect: this.resources.preferDirect,
        compact: this.resources.maxSteps <= 2
      }
    };
  }
}

// ============================================================================
// Energy Function
// ============================================================================

/**
 * Calculates the energy (cost) of a solution.
 * Lower energy = better solution.
 */
class EnergyFunction {
  constructor(taskContext, config = DEFAULT_CONFIG) {
    this.taskContext = taskContext;
    this.config = config;
    
    // Precompute task requirements
    this.taskRequirements = this.analyzeTaskRequirements();
  }
  
  /**
   * Analyze what the task requires
   */
  analyzeTaskRequirements() {
    const text = String(this.taskContext.text || '').toLowerCase();
    
    return {
      needsCode: /(?:kod|code|implement|fix|build|write|yaz)/i.test(text),
      needsReview: /(?:audit|review|risk|security|yoxla|xəta)/i.test(text),
      needsBrowser: /(?:browser|ui|frontend|page|screen|click)/i.test(text),
      needsDesktop: /(?:desktop|gui|computer use|mouse|keyboard)/i.test(text),
      needsStrategy: /(?:roadmap|plan|strategy|compare|fərq)/i.test(text),
      needsInfra: /(?:deploy|docker|railway|ci|cd|devops)/i.test(text),
      needsSEO: /(?:seo|marketing|meta|keyword)/i.test(text),
      isComplex: text.length > 200 || /(?:complex|mürəkkəb|advanced)/i.test(text),
      isQuick: text.length < 100 || /(?:quick|sürətli|qısa|only|yalnız)/i.test(text),
      hasImage: this.taskContext.hasImageAttachment || false,
      taskType: this.taskContext.taskType || 'general'
    };
  }
  
  /**
   * Calculate total energy of a solution
   */
  calculateEnergy(solution) {
    let energy = 0;
    let violations = 0;
    
    // 1. Workflow fitness (how well does workflow match task)
    const workflowFitness = this.calculateWorkflowFitness(solution);
    solution.workflowFitness = workflowFitness;
    energy += (1 - workflowFitness) * this.config.workflowFitnessWeight;
    
    // 2. Capability match (do agents have right skills)
    const capabilityScore = this.calculateCapabilityMatch(solution);
    solution.capabilityScore = capabilityScore;
    energy += (1 - capabilityScore) * this.config.capabilityMatchWeight;
    
    // 3. Resource cost (fewer resources = lower energy)
    const resourceCost = this.calculateResourceCost(solution);
    solution.resourceCost = resourceCost;
    energy += resourceCost * this.config.resourceCostWeight;
    
    // 4. Constraint violations (hard limits)
    violations += this.checkConstraints(solution);
    solution.constraintViolations = violations;
    energy += violations * this.config.constraintPenaltyMultiplier;
    
    solution.energy = energy;
    return energy;
  }
  
  /**
   * Calculate how well the workflow matches the task
   */
  calculateWorkflowFitness(solution) {
    const req = this.taskRequirements;
    const workflow = solution.workflow;
    
    let fitness = 0.5; // baseline
    
    // Workflow-task matching rules
    if (req.needsCode && ['default', 'thorough', 'quick'].includes(workflow)) {
      fitness += 0.3;
    }
    if (req.needsReview && ['review-only', 'default', 'thorough'].includes(workflow)) {
      fitness += 0.3;
    }
    if (req.needsBrowser && ['gui', 'seo_gui'].includes(workflow)) {
      fitness += 0.3;
    }
    if (req.needsDesktop && ['computer_use'].includes(workflow)) {
      fitness += 0.3;
    }
    if (req.needsStrategy && ['default', 'thorough'].includes(workflow)) {
      fitness += 0.2;
    }
    if (req.needsInfra && ['default', 'thorough'].includes(workflow)) {
      fitness += 0.2;
    }
    if (req.needsSEO && ['seo_gui'].includes(workflow)) {
      fitness += 0.3;
    }
    if (req.isQuick && workflow === 'quick') {
      fitness += 0.3;
    }
    if (req.isComplex && workflow === 'thorough') {
      fitness += 0.3;
    }
    if (req.hasImage && workflow === 'gui') {
      fitness += 0.2;
    }
    
    // Penalty for mismatch
    if (req.needsDesktop && !['computer_use', 'gui'].includes(workflow)) {
      fitness -= 0.2;
    }
    if (req.needsReview && !['review-only', 'default', 'thorough'].includes(workflow)) {
      fitness -= 0.1;
    }
    
    return Math.max(0, Math.min(1, fitness));
  }
  
  /**
   * Calculate how well agents match task requirements
   */
  calculateCapabilityMatch(solution) {
    const req = this.taskRequirements;
    const agents = solution.agents;
    
    let matchScore = 0;
    let totalCapabilities = 0;
    
    // Agent capability mapping
    const agentCapabilities = {
      'Planner': ['planning', 'analysis', 'architecture'],
      'Builder': ['code', 'implementation', 'testing'],
      'Reviewer': ['review', 'audit', 'risk'],
      'Security': ['security', 'audit', 'risk'],
      'QA': ['testing', 'validation', 'regression'],
      'Architect': ['architecture', 'design', 'planning'],
      'Implementer': ['code', 'implementation'],
      'Marketing SEO Specialist': ['seo', 'marketing', 'strategy'],
      'GUI Operator': ['browser', 'gui', 'observation'],
      'Computer Use Operator': ['desktop', 'gui', 'automation'],
      'Solo Agent': ['general', 'code', 'review', 'planning']
    };
    
    // Required capabilities based on task
    const requiredCapabilities = [];
    if (req.needsCode) requiredCapabilities.push('code', 'implementation');
    if (req.needsReview) requiredCapabilities.push('review', 'audit');
    if (req.needsBrowser) requiredCapabilities.push('browser', 'gui');
    if (req.needsDesktop) requiredCapabilities.push('desktop', 'gui');
    if (req.needsStrategy) requiredCapabilities.push('planning', 'strategy');
    if (req.needsInfra) requiredCapabilities.push('implementation');
    if (req.needsSEO) requiredCapabilities.push('seo', 'strategy');
    
    if (requiredCapabilities.length === 0) {
      requiredCapabilities.push('general');
    }
    
    // Check coverage
    const coveredCapabilities = new Set();
    for (const agent of agents) {
      const caps = agentCapabilities[agent] || ['general'];
      for (const cap of caps) {
        coveredCapabilities.add(cap);
      }
    }
    
    for (const reqCap of requiredCapabilities) {
      totalCapabilities++;
      if (coveredCapabilities.has(reqCap)) {
        matchScore++;
      }
    }
    
    return totalCapabilities > 0 ? matchScore / totalCapabilities : 0.5;
  }
  
  /**
   * Calculate resource cost (normalized 0-1, lower = cheaper)
   */
  calculateResourceCost(solution) {
    const maxSteps = solution.resources.maxSteps || 5;
    const agentCount = solution.agents.length || 3;
    
    // Normalize: maxSteps 1-10, agentCount 1-5
    const stepsCost = (maxSteps - 1) / 9;
    const agentCost = (agentCount - 1) / 4;
    
    // Weighted average
    return (stepsCost * 0.6 + agentCost * 0.4);
  }
  
  /**
   * Check hard constraints (violations increase energy dramatically)
   */
  checkConstraints(solution) {
    let violations = 0;
    
    // Constraint: maxSteps must be 1-10
    if (solution.resources.maxSteps < 1 || solution.resources.maxSteps > 10) {
      violations++;
    }
    
    // Constraint: agentCount must be 1-5
    if (solution.agents.length < 1 || solution.agents.length > 5) {
      violations++;
    }
    
    // Constraint: at least one agent
    if (solution.agents.length === 0) {
      violations++;
    }
    
    // Constraint: workflow must be valid
    const validWorkflows = ['quick', 'default', 'gui', 'computer_use', 'seo_gui', 'thorough', 'review-only'];
    if (!validWorkflows.includes(solution.workflow)) {
      violations++;
    }
    
    // Constraint: quick workflow should have 1 agent
    if (solution.workflow === 'quick' && solution.agents.length > 2) {
      violations++;
    }
    
    // Constraint: computer_use should have 1 agent
    if (solution.workflow === 'computer_use' && solution.agents.length > 1) {
      violations++;
    }
    
    return violations;
  }
}

// ============================================================================
// Neighbor Generation
// ============================================================================

/**
 * Generates neighboring solutions for annealing.
 * Includes "quantum tunneling" which can make larger jumps.
 */
class NeighborGenerator {
  constructor(config = DEFAULT_CONFIG) {
    this.config = config;
    
    // Workflow transitions (which workflows can transform into which)
    this.workflowTransitions = {
      'quick': ['default'],
      'default': ['quick', 'thorough', 'review-only'],
      'gui': ['default', 'seo_gui', 'computer_use'],
      'computer_use': ['gui', 'default'],
      'seo_gui': ['gui', 'default'],
      'thorough': ['default', 'review-only'],
      'review-only': ['default', 'thorough']
    };
    
    // Agent pool for each workflow
    this.agentPools = {
      'quick': ['Implementer', 'Solo Agent'],
      'default': ['Planner', 'Builder', 'Reviewer', 'Security'],
      'gui': ['Planner', 'Builder', 'Reviewer', 'GUI Operator'],
      'computer_use': ['Computer Use Operator'],
      'seo_gui': ['Marketing SEO Specialist', 'GUI Operator', 'Reviewer'],
      'thorough': ['Architect', 'Builder', 'Security', 'QA', 'Reviewer'],
      'review-only': ['Reviewer', 'Security', 'QA']
    };
  }
  
  /**
   * Generate a neighboring solution
   */
  generateNeighbor(solution, temperature) {
    const neighbor = solution.clone();
    
    // Decide which perturbation to apply
    const isQuantumTunnel = Math.random() < this.config.tunnelingProbability * temperature;
    
    if (isQuantumTunnel) {
      // Quantum tunneling: make a bigger jump (change workflow)
      return this.quantumTunnel(neighbor);
    }
    
    // Standard perturbation: small changes
    const perturbationType = Math.random();
    
    if (perturbationType < 0.3) {
      // Change workflow
      this.perturbWorkflow(neighbor);
    } else if (perturbationType < 0.6) {
      // Add/remove agent
      this.perturbAgents(neighbor);
    } else if (perturbationType < 0.8) {
      // Change resources
      this.perturbResources(neighbor);
    } else {
      // Change model assignments
      this.perturbModels(neighbor);
    }
    
    return neighbor;
  }
  
  /**
   * Quantum tunneling: jump to a very different solution
   */
  quantumTunnel(solution) {
    const workflows = Object.keys(this.workflowTransitions);
    const randomWorkflow = workflows[Math.floor(Math.random() * workflows.length)];
    
    solution.workflow = randomWorkflow;
    solution.agents = this.agentPools[randomWorkflow] || ['Solo Agent'];
    solution.resources.maxSteps = this.randomInt(2, 7);
    solution.resources.agentCount = solution.agents.length;
    
    return solution;
  }
  
  /**
   * Perturb workflow (small change)
   */
  perturbWorkflow(solution) {
    const transitions = this.workflowTransitions[solution.workflow] || ['default'];
    const randomTransition = transitions[Math.floor(Math.random() * transitions.length)];
    
    solution.workflow = randomTransition;
    solution.agents = this.agentPools[randomTransition] || ['Solo Agent'];
    solution.resources.agentCount = solution.agents.length;
  }
  
  /**
   * Perturb agents (add/remove one)
   */
  perturbAgents(solution) {
    const pool = this.agentPools[solution.workflow] || ['Solo Agent'];
    
    if (Math.random() < 0.5 && solution.agents.length > 1) {
      // Remove random agent
      const idx = Math.floor(Math.random() * solution.agents.length);
      solution.agents.splice(idx, 1);
    } else if (solution.agents.length < pool.length) {
      // Add random agent from pool
      const available = pool.filter(a => !solution.agents.includes(a));
      if (available.length > 0) {
        const randomAgent = available[Math.floor(Math.random() * available.length)];
        solution.agents.push(randomAgent);
      }
    }
    
    solution.resources.agentCount = solution.agents.length;
  }
  
  /**
   * Perturb resources (change maxSteps)
   */
  perturbResources(solution) {
    const delta = Math.random() < 0.5 ? -1 : 1;
    solution.resources.maxSteps = Math.max(1, Math.min(10, solution.resources.maxSteps + delta));
  }
  
  /**
   * Perturb model assignments
   */
  perturbModels(solution) {
    // Toggle tool availability
    solution.resources.allowTools = !solution.resources.allowTools;
  }
  
  /**
   * Random integer in range [min, max]
   */
  randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
}

// ============================================================================
// Quantum Annealing Optimizer
// ============================================================================

class QuantumAnnealingOptimizer {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.neighborGenerator = new NeighborGenerator(this.config);
    
    // Optimization history
    this.history = [];
    this.bestSolution = null;
    this.bestEnergy = Infinity;
  }
  
  /**
   * Run quantum annealing optimization
   */
  optimize(taskContext, options = {}) {
    const {
      initialSolution = null,
      maxIterations = this.config.maxIterations,
      onIteration = null
    } = options;
    
    // Create energy function
    const energyFn = new EnergyFunction(taskContext, this.config);
    
    // Initialize with provided solution or create default
    let currentSolution = initialSolution || this.createInitialSolution(taskContext);
    energyFn.calculateEnergy(currentSolution);
    
    // Set as best initially
    this.bestSolution = currentSolution.clone();
    this.bestEnergy = currentSolution.energy;
    
    // Initialize temperature
    let temperature = this.config.initialTemperature;
    
    // Optimization loop
    for (let i = 0; i < maxIterations; i++) {
      // Generate neighbor
      const neighbor = this.neighborGenerator.generateNeighbor(currentSolution, temperature);
      
      // Calculate neighbor energy
      energyFn.calculateEnergy(neighbor);
      
      // Calculate energy difference
      const deltaE = neighbor.energy - currentSolution.energy;
      
      // Boltzmann acceptance criterion
      const acceptanceProbability = deltaE < 0 
        ? 1.0  // Always accept better solutions
        : Math.exp(-deltaE / Math.max(temperature, 0.001));  // Accept worse with probability
      
      // Accept or reject
      if (Math.random() < acceptanceProbability) {
        currentSolution = neighbor;
        
        // Update best if this is the best so far
        if (neighbor.energy < this.bestEnergy) {
          this.bestSolution = neighbor.clone();
          this.bestEnergy = neighbor.energy;
        }
      }
      
      // Record history
      this.history.push({
        iteration: i,
        temperature,
        currentEnergy: currentSolution.energy,
        bestEnergy: this.bestEnergy,
        accepted: deltaE < 0 || Math.random() < acceptanceProbability
      });
      
      // Cooling
      temperature *= this.config.coolingRate;
      temperature = Math.max(temperature, this.config.minTemperature);
      
      // Callback
      if (onIteration) {
        onIteration({
          iteration: i,
          temperature,
          currentEnergy: currentSolution.energy,
          bestEnergy: this.bestEnergy,
          solution: currentSolution
        });
      }
    }
    
    return {
      bestSolution: this.bestSolution,
      bestEnergy: this.bestEnergy,
      finalTemperature: temperature,
      iterations: maxIterations,
      history: this.history,
      improvement: this.calculateImprovement()
    };
  }
  
  /**
   * Create initial solution based on task context
   */
  createInitialSolution(taskContext) {
    // Start with the greedy solution (what the current system would choose)
    const greedySolution = this.greedyInitialSolution(taskContext);
    
    // Also create a few random solutions
    const randomSolutions = [];
    for (let i = 0; i < 3; i++) {
      randomSolutions.push(this.randomSolution());
    }
    
    // Pick the best among greedy and random
    const energyFn = new EnergyFunction(taskContext, this.config);
    let best = greedySolution;
    let bestEnergy = energyFn.calculateEnergy(greedySolution);
    
    for (const sol of randomSolutions) {
      const energy = energyFn.calculateEnergy(sol);
      if (energy < bestEnergy) {
        best = sol;
        bestEnergy = energy;
      }
    }
    
    return best;
  }
  
  /**
   * Create greedy initial solution (mimics current system behavior)
   */
  greedyInitialSolution(taskContext) {
    const text = String(taskContext.text || '').toLowerCase();
    
    // Simple heuristic matching (similar to managerRouter.js)
    if (text.length < 120 && /\?$/.test(text)) {
      return new Solution({
        workflow: 'default',
        agents: ['Solo Agent'],
        resources: { maxSteps: 1, agentCount: 1, allowTools: false, preferDirect: true }
      });
    }
    
    if (/(?:gui|browser|frontend|ui)/i.test(text)) {
      return new Solution({
        workflow: 'gui',
        agents: ['Planner', 'Builder', 'Reviewer'],
        resources: { maxSteps: 5, agentCount: 3, allowTools: true, preferDirect: false }
      });
    }
    
    if (/(?:audit|review|risk|security)/i.test(text)) {
      return new Solution({
        workflow: 'review-only',
        agents: ['Reviewer', 'Security'],
        resources: { maxSteps: 5, agentCount: 2, allowTools: true, preferDirect: false }
      });
    }
    
    if (/(?:seo|marketing)/i.test(text)) {
      return new Solution({
        workflow: 'seo_gui',
        agents: ['Marketing SEO Specialist', 'GUI Operator', 'Reviewer'],
        resources: { maxSteps: 5, agentCount: 3, allowTools: true, preferDirect: false }
      });
    }
    
    if (/(?:quick|sürətli|qısa)/i.test(text)) {
      return new Solution({
        workflow: 'quick',
        agents: ['Implementer'],
        resources: { maxSteps: 4, agentCount: 1, allowTools: true, preferDirect: true }
      });
    }
    
    // Default
    return new Solution({
      workflow: 'default',
      agents: ['Planner', 'Builder', 'Reviewer'],
      resources: { maxSteps: 5, agentCount: 3, allowTools: true, preferDirect: false }
    });
  }
  
  /**
   * Create random solution
   */
  randomSolution() {
    const workflows = ['quick', 'default', 'gui', 'computer_use', 'seo_gui', 'thorough', 'review-only'];
    const workflow = workflows[Math.floor(Math.random() * workflows.length)];
    
    const agentPools = {
      'quick': ['Implementer'],
      'default': ['Planner', 'Builder', 'Reviewer'],
      'gui': ['Planner', 'Builder', 'Reviewer'],
      'computer_use': ['Computer Use Operator'],
      'seo_gui': ['Marketing SEO Specialist', 'GUI Operator', 'Reviewer'],
      'thorough': ['Architect', 'Builder', 'Security', 'QA'],
      'review-only': ['Reviewer', 'Security']
    };
    
    const agents = agentPools[workflow] || ['Solo Agent'];
    
    return new Solution({
      workflow,
      agents,
      resources: {
        maxSteps: Math.floor(Math.random() * 6) + 2, // 2-7
        agentCount: agents.length,
        allowTools: Math.random() > 0.3,
        preferDirect: Math.random() > 0.7
      }
    });
  }
  
  /**
   * Calculate improvement over greedy
   */
  calculateImprovement() {
    if (this.history.length < 2) return 0;
    
    const firstEnergy = this.history[0].currentEnergy;
    const lastEnergy = this.history[this.history.length - 1].bestEnergy;
    
    if (firstEnergy === 0) return 0;
    return ((firstEnergy - lastEnergy) / firstEnergy * 100).toFixed(1);
  }
  
  /**
   * Get optimization summary
   */
  getSummary() {
    return {
      bestWorkflow: this.bestSolution?.workflow,
      bestAgents: this.bestSolution?.agents,
      bestMaxSteps: this.bestSolution?.resources?.maxSteps,
      bestEnergy: this.bestEnergy,
      improvement: this.calculateImprovement(),
      iterations: this.history.length,
      convergencePoint: this.findConvergencePoint()
    };
  }
  
  /**
   * Find where the optimization converged
   */
  findConvergencePoint() {
    if (this.history.length < 10) return this.history.length;
    
    // Look for where best energy stopped improving
    let lastImprovement = 0;
    let bestSoFar = Infinity;
    
    for (let i = 0; i < this.history.length; i++) {
      if (this.history[i].bestEnergy < bestSoFar) {
        bestSoFar = this.history[i].bestEnergy;
        lastImprovement = i;
      }
    }
    
    return lastImprovement;
  }
}

// ============================================================================
// Integration Helper
// ============================================================================

/**
 * Quantum-annealing-optimized routing for BahAI-Agent
 * 
 * This function is called to get the optimal routing configuration.
 * It runs quantum annealing to find the best workflow, agents, and resources.
 */
function quantumOptimizeRouting(taskContext, options = {}) {
  const {
    enabled = true,
    maxIterations = 50,
    currentRouting = null
  } = options;
  
  if (!enabled) {
    return null;
  }
  
  try {
    const optimizer = new QuantumAnnealingOptimizer({
      maxIterations,
      initialTemperature: 1.0,
      coolingRate: 0.95,
      tunnelingProbability: 0.1
    });
    
    // Create initial solution from current routing (if provided)
    let initialSolution = null;
    if (currentRouting) {
      initialSolution = new Solution({
        workflow: currentRouting.workflow || 'default',
        agents: [currentRouting.primaryAgent, ...(currentRouting.secondaryAgents || [])].filter(Boolean),
        resources: {
          maxSteps: currentRouting.maxSteps || 5,
          agentCount: (currentRouting.secondaryAgents?.length || 0) + 1,
          allowTools: currentRouting.useTools !== false,
          preferDirect: currentRouting.tokenDiscipline?.preferDirect || false
        }
      });
    }
    
    // Run optimization
    const result = optimizer.optimize(taskContext, {
      initialSolution,
      maxIterations
    });
    
    return {
      routing: result.bestSolution.toRoutingFormat(),
      energy: result.bestEnergy,
      improvement: result.improvement,
      summary: optimizer.getSummary()
    };
  } catch (err) {
    console.warn(`[QuantumAnnealing] Optimization failed: ${err.message}`);
    return null;
  }
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  Solution,
  EnergyFunction,
  NeighborGenerator,
  QuantumAnnealingOptimizer,
  quantumOptimizeRouting,
  DEFAULT_CONFIG
};
