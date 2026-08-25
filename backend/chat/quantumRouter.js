/**
 * bahAI - Quantum Superposition Router
 * 
 * A quantum-inspired provider routing system that probes multiple providers
 * in parallel ("superposition") and uses probabilistic selection ("wave function
 * collapse") to pick the optimal provider. This replaces the serial failover
 * approach where each provider is tried one-by-one.
 * 
 * Key concepts:
 * - Superposition: Multiple providers are probed simultaneously
 * - Amplitude: Each provider has a "quantum amplitude" based on latency,
 *   reliability, and availability
 * - Collapse: When we "measure" (select), the provider with highest amplitude
 *   is most likely to be chosen, but even slower providers get a chance
 * - Entanglement: Provider performance history influences future selections
 */

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_CONFIG = {
  // Number of top providers to probe in parallel
  probeCount: 3,
  
  // Timeout for lightweight probe (ms)
  probeTimeoutMs: 2000,
  
  // Cooldown after provider failure (ms)
  failureCooldownMs: 5000,
  
  // Maximum cooldown (ms)
  maxCooldownMs: 60000,
  
  // Learning rate for amplitude updates (0-1, higher = more reactive)
  learningRate: 0.3,
  
  // Minimum amplitude (prevents zero probability)
  minAmplitude: 0.05,
  
  // Maximum amplitude
  maxAmplitude: 1.0,
  
  // Initial amplitude for new providers
  initialAmplitude: 0.5,
  
  // Whether to use probabilistic selection (true) or deterministic (false)
  probabilisticSelection: true,
  
  // Temperature for softmax selection (higher = more random, lower = more greedy)
  temperature: 0.5,
};

// ============================================================================
// Provider State Tracker
// ============================================================================

class ProviderState {
  constructor(id, provider) {
    this.id = id;
    this.provider = provider;
    this.amplitude = DEFAULT_CONFIG.initialAmplitude;
    this.totalProbes = 0;
    this.successfulProbes = 0;
    this.failedProbes = 0;
    this.totalLatency = 0;
    this.lastProbeTime = 0;
    this.lastSuccessTime = 0;
    this.lastFailureTime = 0;
    this.cooldownUntil = 0;
    this.consecutiveFailures = 0;
  }
  
  recordSuccess(latencyMs) {
    this.totalProbes++;
    this.successfulProbes++;
    this.totalLatency += latencyMs;
    this.lastProbeTime = Date.now();
    this.lastSuccessTime = Date.now();
    this.consecutiveFailures = 0;
    this.cooldownUntil = 0;
    
    // Update amplitude: faster = higher amplitude
    const avgLatency = this.totalLatency / this.successfulProbes;
    const latencyScore = Math.max(0, 1 - (avgLatency / 10000)); // 10s = 0 score
    const successRate = this.successfulProbes / this.totalProbes;
    
    // Amplitude = weighted average of latency score and success rate
    const targetAmplitude = (latencyScore * 0.6 + successRate * 0.4);
    
    // Smooth update with learning rate
    this.amplitude = this.amplitude * (1 - DEFAULT_CONFIG.learningRate) 
      + targetAmplitude * DEFAULT_CONFIG.learningRate;
    
    // Clamp
    this.amplitude = Math.max(DEFAULT_CONFIG.minAmplitude, 
      Math.min(DEFAULT_CONFIG.maxAmplitude, this.amplitude));
  }
  
  recordFailure() {
    this.totalProbes++;
    this.failedProbes++;
    this.lastProbeTime = Date.now();
    this.lastFailureTime = Date.now();
    this.consecutiveFailures++;
    
    // Exponential backoff for cooldown
    this.cooldownUntil = Date.now() + Math.min(
      DEFAULT_CONFIG.failureCooldownMs * Math.pow(2, this.consecutiveFailures - 1),
      DEFAULT_CONFIG.maxCooldownMs
    );
    
    // Reduce amplitude
    this.amplitude *= 0.5;
    this.amplitude = Math.max(DEFAULT_CONFIG.minAmplitude, this.amplitude);
  }
  
  isAvailable() {
    return Date.now() >= this.cooldownUntil;
  }
  
  getAverageLatency() {
    return this.successfulProbes > 0 
      ? this.totalLatency / this.successfulProbes 
      : Infinity;
  }
  
  getSuccessRate() {
    return this.totalProbes > 0 
      ? this.successfulProbes / this.totalProbes 
      : 0;
  }
}

// ============================================================================
// Quantum Superposition Router
// ============================================================================

class QuantumSuperpositionRouter {
  constructor(options = {}) {
    this.config = { ...DEFAULT_CONFIG, ...options };
    this.providers = new Map(); // id → ProviderState
    this.probeHistory = []; // Last N probes for analysis
    this.maxHistory = 100;
  }
  
  /**
   * Register providers for quantum routing
   */
  registerProviders(providers) {
    for (const provider of providers) {
      if (!this.providers.has(provider.id)) {
        this.providers.set(provider.id, new ProviderState(provider.id, provider));
      }
    }
  }
  
  /**
   * Lightweight probe to check if provider is reachable
   * Returns { reachable: boolean, latencyMs: number, error?: string }
   */
  async probeProvider(providerState, queryContext = {}) {
    const startTime = Date.now();
    const provider = providerState.provider || providerState;
    
    try {
      // Create a minimal OpenAI client for probing
      const { OpenAI } = require('openai');
      const client = new OpenAI({
        baseURL: provider.baseURL,
        apiKey: provider.apiKey,
        timeout: this.config.probeTimeoutMs,
      });
      
      // Lightweight probe: send minimal request
      const probeMessages = [
        { role: 'user', content: 'ping' }
      ];
      
      // Use abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.probeTimeoutMs);
      
      try {
        const response = await client.chat.completions.create({
          model: provider.model,
          messages: probeMessages,
          max_tokens: 1,
          stream: false,
        }, { signal: controller.signal });
        
        clearTimeout(timeoutId);
        const latencyMs = Date.now() - startTime;
        
        return {
          reachable: true,
          latencyMs,
          response: response?.choices?.[0]?.message?.content || 'ok'
        };
      } catch (err) {
        clearTimeout(timeoutId);
        
        // Check if it's a timeout or abort
        if (err.name === 'AbortError' || err.message?.includes('timeout')) {
          return {
            reachable: false,
            latencyMs: Date.now() - startTime,
            error: 'timeout'
          };
        }
        
        // Check if it's a rate limit (provider is alive but busy)
        if (err.status === 429) {
          return {
            reachable: true,
            latencyMs: Date.now() - startTime,
            error: 'rate_limited'
          };
        }
        
        // Check if it's an auth error (provider is alive but misconfigured)
        if (err.status === 401 || err.status === 402) {
          return {
            reachable: false,
            latencyMs: Date.now() - startTime,
            error: 'auth_error'
          };
        }
        
        // Other errors
        return {
          reachable: false,
          latencyMs: Date.now() - startTime,
          error: err.message || 'unknown'
        };
      }
    } catch (err) {
      return {
        reachable: false,
        latencyMs: Date.now() - startTime,
        error: err.message || 'probe_error'
      };
    }
  }
  
  /**
   * Probe multiple providers in parallel ("superposition")
   * Returns probe results for each provider
   */
  async probeProviders(providers, queryContext = {}) {
    const probePromises = providers.map(async (rawProvider) => {
      // Resolve the ProviderState wrapper if registered, else wrap raw object
      const state = this.providers.get(rawProvider.id) || new ProviderState(rawProvider.id, rawProvider);
      const result = await this.probeProvider(state, queryContext);
      return {
        providerId: rawProvider.id,
        provider: rawProvider,
        ...result
      };
    });
    
    // Wait for all probes with overall timeout
    const results = await Promise.allSettled(probePromises);
    
    return results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      }
      return {
        providerId: providers[index].id,
        provider: providers[index],
        reachable: false,
        latencyMs: 0,
        error: result.reason?.message || 'probe_failed'
      };
    });
  }
  
  /**
   * Calculate amplitude for a provider based on probe results
   */
  calculateAmplitude(providerState, probeResult) {
    if (!probeResult.reachable) {
      return 0;
    }
    
    // Base amplitude from historical performance
    let amplitude = providerState.amplitude;
    
    // Boost for successful probe
    if (probeResult.reachable) {
      // Latency factor: faster = higher amplitude
      const latencyFactor = Math.max(0, 1 - (probeResult.latencyMs / 5000)); // 5s = 0
      
      // Rate limit penalty: still reachable but busy
      const rateLimitPenalty = probeResult.error === 'rate_limited' ? 0.3 : 1;
      
      // Calculate probe-specific amplitude
      const probeAmplitude = amplitude * latencyFactor * rateLimitPenalty;
      
      return Math.max(DEFAULT_CONFIG.minAmplitude, probeAmplitude);
    }
    
    return 0;
  }
  
  /**
   * Wave function collapse: probabilistic selection based on amplitudes
   * Uses softmax with temperature for controlled randomness
   */
  collapseWaveFunction(candidates) {
    if (candidates.length === 0) {
      return null;
    }
    
    if (candidates.length === 1) {
      return candidates[0];
    }
    
    if (!this.config.probabilisticSelection) {
      // Deterministic: pick highest amplitude
      return candidates.reduce((best, curr) => 
        curr.amplitude > best.amplitude ? curr : best
      );
    }
    
    // Softmax with temperature for probabilistic selection
    const temperatures = candidates.map(c => c.amplitude / this.config.temperature);
    const maxTemp = Math.max(...temperatures);
    
    // Numerical stability: subtract max
    const expTemps = temperatures.map(t => Math.exp(t - maxTemp));
    const sumExp = expTemps.reduce((a, b) => a + b, 0);
    
    // Calculate probabilities
    const probabilities = expTemps.map(e => e / sumExp);
    
    // Weighted random selection
    const random = Math.random();
    let cumulative = 0;
    
    for (let i = 0; i < candidates.length; i++) {
      cumulative += probabilities[i];
      if (random <= cumulative) {
        return candidates[i];
      }
    }
    
    // Fallback: last candidate
    return candidates[candidates.length - 1];
  }
  
  /**
   * Select optimal provider using quantum superposition
   * This is the main entry point
   */
  async selectOptimalProvider(providers, queryContext = {}) {
    // Register providers if not already tracked
    this.registerProviders(providers);
    
    // Filter available providers (not in cooldown)
    const availableProviders = providers.filter(p => {
      const state = this.providers.get(p.id);
      return state ? state.isAvailable() : true;
    });
    
    if (availableProviders.length === 0) {
      // All providers in cooldown — use the one with shortest cooldown
      const sortedByCooldown = [...providers].sort((a, b) => {
        const stateA = this.providers.get(a.id);
        const stateB = this.providers.get(b.id);
        return (stateA?.cooldownUntil || 0) - (stateB?.cooldownUntil || 0);
      });
      return {
        selected: sortedByCooldown[0],
        amplitudes: [],
        probeResults: [],
        selectionMethod: 'cooldown_fallback'
      };
    }
    
    // Select top N providers to probe
    const providersToProbe = availableProviders
      .slice(0, this.config.probeCount);
    
    // Probe in parallel ("superposition")
    const probeResults = await this.probeProviders(providersToProbe, queryContext);
    
    // Calculate amplitudes
    const candidates = probeResults.map(probeResult => {
      const providerState = this.providers.get(probeResult.providerId);
      const amplitude = this.calculateAmplitude(providerState, probeResult);
      
      return {
        provider: probeResult.provider,
        amplitude,
        probeResult,
        providerState
      };
    });
    
    // Filter reachable providers
    const reachableCandidates = candidates.filter(c => c.amplitude > 0);
    
    if (reachableCandidates.length === 0) {
      // No providers reachable — fall back to serial failover
      return {
        selected: providers[0],
        amplitudes: candidates.map(c => ({
          providerId: c.provider.id,
          amplitude: c.amplitude
        })),
        probeResults,
        selectionMethod: 'serial_fallback'
      };
    }
    
    // Wave function collapse: probabilistic selection
    const selected = this.collapseWaveFunction(reachableCandidates);
    
    // Record probe results for learning
    for (const candidate of candidates) {
      const providerState = this.providers.get(candidate.provider.id);
      if (providerState) {
        if (candidate.probeResult.reachable) {
          providerState.recordSuccess(candidate.probeResult.latencyMs);
        } else {
          providerState.recordFailure();
        }
      }
    }
    
    // Store in history
    this.probeHistory.push({
      timestamp: Date.now(),
      probeResults,
      selected: selected.provider.id,
      queryContext: queryContext.taskType || 'unknown'
    });
    
    // Trim history
    if (this.probeHistory.length > this.maxHistory) {
      this.probeHistory = this.probeHistory.slice(-this.maxHistory);
    }
    
    return {
      selected: selected.provider,
      amplitudes: candidates.map(c => ({
        providerId: c.provider.id,
        amplitude: c.amplitude,
        latencyMs: c.probeResult.latencyMs,
        reachable: c.probeResult.reachable
      })),
      probeResults,
      selectionMethod: 'quantum_superposition'
    };
  }
  
  /**
   * Get provider statistics for monitoring
   */
  getProviderStats() {
    const stats = [];
    for (const [id, state] of this.providers) {
      stats.push({
        id,
        model: state.provider.model,
        amplitude: state.amplitude,
        totalProbes: state.totalProbes,
        successRate: state.getSuccessRate(),
        averageLatency: state.getAverageLatency(),
        consecutiveFailures: state.consecutiveFailures,
        cooldownUntil: state.cooldownUntil,
        isAvailable: state.isAvailable()
      });
    }
    return stats;
  }
  
  /**
   * Reset provider state (for testing or manual reset)
   */
  resetProvider(providerId) {
    const state = this.providers.get(providerId);
    if (state) {
      state.amplitude = DEFAULT_CONFIG.initialAmplitude;
      state.totalProbes = 0;
      state.successfulProbes = 0;
      state.failedProbes = 0;
      state.totalLatency = 0;
      state.consecutiveFailures = 0;
      state.cooldownUntil = 0;
    }
  }
  
  /**
   * Reset all providers
   */
  resetAll() {
    for (const [id] of this.providers) {
      this.resetProvider(id);
    }
    this.probeHistory = [];
  }
}

// ============================================================================
// Singleton instance
// ============================================================================

let defaultRouter = null;

function getQuantumRouter(options) {
  if (!defaultRouter) {
    defaultRouter = new QuantumSuperpositionRouter(options);
  }
  return defaultRouter;
}

function resetQuantumRouter() {
  if (defaultRouter) {
    defaultRouter.resetAll();
    defaultRouter = null;
  }
}

// ============================================================================
// Integration helper for runner.js
// ============================================================================

/**
 * Quantum-enhanced provider selection for openAiStreamWithFallback
 * 
 * This function is called before the main provider loop to select the
 * optimal starting provider. If quantum routing is disabled or fails,
 * it falls back to the first candidate (serial failover).
 */
async function quantumSelectProvider(providerCandidates, options = {}) {
  const {
    enabled = true,
    probeCount = 3,
    probeTimeoutMs = 2000,
    taskType = 'general',
    queryContext = {}
  } = options;
  
  if (!enabled || !providerCandidates || providerCandidates.length === 0) {
    return null;
  }
  
  // Skip quantum routing for single provider
  if (providerCandidates.length === 1) {
    return null;
  }
  
  try {
    const router = getQuantumRouter({
      probeCount: Math.min(probeCount, providerCandidates.length),
      probeTimeoutMs
    });
    
    const result = await router.selectOptimalProvider(providerCandidates, {
      taskType,
      ...queryContext
    });
    
    // Log quantum routing decision
    if (result.selectionMethod === 'quantum_superposition') {
      console.log(`🔀 Quantum routing: selected ${result.selected.id} (${result.selected.model})`);
      console.log(`   Amplitudes: ${result.amplitudes.map(a => 
        `${a.providerId}=${a.amplitude.toFixed(2)} (${a.latencyMs}ms)`
      ).join(', ')}`);
    }
    
    return result;
  } catch (err) {
    console.warn(`[QuantumRouter] Routing failed, falling back to serial: ${err.message}`);
    return null;
  }
}

module.exports = {
  QuantumSuperpositionRouter,
  ProviderState,
  getQuantumRouter,
  resetQuantumRouter,
  quantumSelectProvider,
  DEFAULT_CONFIG
};
