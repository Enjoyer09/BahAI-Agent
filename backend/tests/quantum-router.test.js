import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { 
  QuantumSuperpositionRouter, 
  ProviderState, 
  getQuantumRouter, 
  resetQuantumRouter,
  DEFAULT_CONFIG 
} from '../chat/quantumRouter.js';

// ============================================================================
// ProviderState Tests
// ============================================================================

describe('ProviderState', () => {
  let providerState;
  
  beforeEach(() => {
    providerState = new ProviderState('test-provider', {
      id: 'test-provider',
      apiKey: 'test-key',
      baseURL: 'https://api.test.com/v1',
      model: 'test-model'
    });
  });
  
  it('initializes with default amplitude', () => {
    expect(providerState.amplitude).toBe(DEFAULT_CONFIG.initialAmplitude);
    expect(providerState.totalProbes).toBe(0);
    expect(providerState.successfulProbes).toBe(0);
    expect(providerState.failedProbes).toBe(0);
  });
  
  it('records success and updates amplitude', () => {
    providerState.recordSuccess(500); // 500ms latency
    
    expect(providerState.totalProbes).toBe(1);
    expect(providerState.successfulProbes).toBe(1);
    expect(providerState.totalLatency).toBe(500);
    expect(providerState.lastSuccessTime).toBeGreaterThan(0);
    expect(providerState.consecutiveFailures).toBe(0);
    expect(providerState.cooldownUntil).toBe(0);
  });
  
  it('records failure and applies cooldown', () => {
    const before = Date.now();
    providerState.recordFailure();
    
    expect(providerState.totalProbes).toBe(1);
    expect(providerState.failedProbes).toBe(1);
    expect(providerState.consecutiveFailures).toBe(1);
    expect(providerState.cooldownUntil).toBeGreaterThan(before);
    expect(providerState.amplitude).toBeLessThan(DEFAULT_CONFIG.initialAmplitude);
  });
  
  it('applies exponential backoff for consecutive failures', () => {
    providerState.recordFailure();
    const cooldown1 = providerState.cooldownUntil;
    
    providerState.recordFailure();
    const cooldown2 = providerState.cooldownUntil;
    
    // Second cooldown should be longer (exponential backoff)
    expect(cooldown2 - Date.now()).toBeGreaterThan(cooldown1 - Date.now());
  });
  
  it('checks availability correctly', () => {
    // Initially available
    expect(providerState.isAvailable()).toBe(true);
    
    // After failure, not available until cooldown
    providerState.recordFailure();
    expect(providerState.isAvailable()).toBe(false);
    
    // Manually set cooldown to past
    providerState.cooldownUntil = Date.now() - 1000;
    expect(providerState.isAvailable()).toBe(true);
  });
  
  it('calculates average latency correctly', () => {
    providerState.recordSuccess(1000);
    providerState.recordSuccess(2000);
    
    expect(providerState.getAverageLatency()).toBe(1500);
  });
  
  it('calculates success rate correctly', () => {
    providerState.recordSuccess(500);
    providerState.recordSuccess(500);
    providerState.recordFailure();
    
    expect(providerState.getSuccessRate()).toBeCloseTo(0.667, 2);
  });
});

// ============================================================================
// QuantumSuperpositionRouter Tests
// ============================================================================

describe('QuantumSuperpositionRouter', () => {
  let router;
  
  beforeEach(() => {
    router = new QuantumSuperpositionRouter({
      probeCount: 2,
      probeTimeoutMs: 1000,
      probabilisticSelection: false // Deterministic for testing
    });
  });
  
  afterEach(() => {
    router.resetAll();
  });
  
  it('registers providers correctly', () => {
    const providers = [
      { id: 'provider-1', apiKey: 'key1', baseURL: 'https://api1.com/v1', model: 'model1' },
      { id: 'provider-2', apiKey: 'key2', baseURL: 'https://api2.com/v1', model: 'model2' }
    ];
    
    router.registerProviders(providers);
    
    expect(router.providers.size).toBe(2);
    expect(router.providers.has('provider-1')).toBe(true);
    expect(router.providers.has('provider-2')).toBe(true);
  });
  
  it('calculates amplitude correctly for reachable provider', () => {
    const providerState = new ProviderState('test', {
      id: 'test',
      apiKey: 'key',
      baseURL: 'https://api.test.com/v1',
      model: 'model'
    });
    
    const probeResult = {
      reachable: true,
      latencyMs: 500,
      error: null
    };
    
    const amplitude = router.calculateAmplitude(providerState, probeResult);
    
    expect(amplitude).toBeGreaterThan(0);
    expect(amplitude).toBeLessThanOrEqual(1);
  });
  
  it('returns 0 amplitude for unreachable provider', () => {
    const providerState = new ProviderState('test', {
      id: 'test',
      apiKey: 'key',
      baseURL: 'https://api.test.com/v1',
      model: 'model'
    });
    
    const probeResult = {
      reachable: false,
      latencyMs: 0,
      error: 'timeout'
    };
    
    const amplitude = router.calculateAmplitude(providerState, probeResult);
    
    expect(amplitude).toBe(0);
  });
  
  it('collapses wave function deterministically when disabled', () => {
    const candidates = [
      { provider: { id: 'p1' }, amplitude: 0.3 },
      { provider: { id: 'p2' }, amplitude: 0.7 },
      { provider: { id: 'p3' }, amplitude: 0.5 }
    ];
    
    const selected = router.collapseWaveFunction(candidates);
    
    // Should select highest amplitude (p2)
    expect(selected.provider.id).toBe('p2');
  });
  
  it('collapses wave function probabilistically when enabled', () => {
    const probRouter = new QuantumSuperpositionRouter({
      probabilisticSelection: true,
      temperature: 0.1 // Low temperature = more greedy
    });
    
    const candidates = [
      { provider: { id: 'p1' }, amplitude: 0.2 },
      { provider: { id: 'p2' }, amplitude: 0.8 },
      { provider: { id: 'p3' }, amplitude: 0.5 }
    ];
    
    // Run multiple times - should mostly select p2
    const selections = [];
    for (let i = 0; i < 100; i++) {
      const selected = probRouter.collapseWaveFunction(candidates);
      selections.push(selected.provider.id);
    }
    
    const p2Count = selections.filter(s => s === 'p2').length;
    expect(p2Count).toBeGreaterThan(50); // Should be majority
  });
  
  it('handles single candidate', () => {
    const candidates = [
      { provider: { id: 'p1' }, amplitude: 0.5 }
    ];
    
    const selected = router.collapseWaveFunction(candidates);
    
    expect(selected.provider.id).toBe('p1');
  });
  
  it('handles empty candidates', () => {
    const selected = router.collapseWaveFunction([]);
    
    expect(selected).toBeNull();
  });
  
  it('tracks provider statistics', () => {
    const providers = [
      { id: 'provider-1', apiKey: 'key1', baseURL: 'https://api1.com/v1', model: 'model1' }
    ];
    
    router.registerProviders(providers);
    
    const stats = router.getProviderStats();
    
    expect(stats).toHaveLength(1);
    expect(stats[0].id).toBe('provider-1');
    expect(stats[0].amplitude).toBe(DEFAULT_CONFIG.initialAmplitude);
  });
  
  it('resets provider state correctly', () => {
    const provider = { id: 'test', apiKey: 'key', baseURL: 'https://api.test.com/v1', model: 'model' };
    router.registerProviders([provider]);
    
    const state = router.providers.get('test');
    state.recordSuccess(500);
    state.recordFailure();
    
    router.resetProvider('test');
    
    expect(state.amplitude).toBe(DEFAULT_CONFIG.initialAmplitude);
    expect(state.totalProbes).toBe(0);
    expect(state.consecutiveFailures).toBe(0);
  });
});

// ============================================================================
// Singleton Tests
// ============================================================================

describe('Quantum Router Singleton', () => {
  beforeEach(() => {
    resetQuantumRouter();
  });
  
  afterEach(() => {
    resetQuantumRouter();
  });
  
  it('creates singleton instance', () => {
    const router1 = getQuantumRouter();
    const router2 = getQuantumRouter();
    
    expect(router1).toBe(router2);
  });
  
  it('creates new instance after reset', () => {
    const router1 = getQuantumRouter();
    resetQuantumRouter();
    const router2 = getQuantumRouter();
    
    expect(router1).not.toBe(router2);
  });
});

// ============================================================================
// Integration Tests (with mocked OpenAI)
// ============================================================================

describe('Quantum Router Integration', () => {
  let router;
  
  beforeEach(() => {
    router = new QuantumSuperpositionRouter({
      probeCount: 2,
      probeTimeoutMs: 500,
      probabilisticSelection: false
    });
  });
  
  afterEach(() => {
    router.resetAll();
  });
  
  it('selects optimal provider from candidates', async () => {
    // Mock the probeProvider method to simulate different latencies
    router.probeProvider = async (providerState) => {
      const latencies = {
        'slow-provider': 500,
        'fast-provider': 100,
        'medium-provider': 300
      };
      const id = providerState.id || providerState.provider?.id;
      return {
        reachable: true,
        latencyMs: latencies[id] || 200,
        error: null
      };
    };
    
    const providers = [
      { id: 'slow-provider', apiKey: 'key1', baseURL: 'https://slow.api.com/v1', model: 'model1' },
      { id: 'fast-provider', apiKey: 'key2', baseURL: 'https://fast.api.com/v1', model: 'model2' },
      { id: 'medium-provider', apiKey: 'key3', baseURL: 'https://medium.api.com/v1', model: 'model3' }
    ];
    
    const result = await router.selectOptimalProvider(providers);
    
    expect(result.selected).toBeDefined();
    expect(result.amplitudes.length).toBeGreaterThanOrEqual(2);
    expect(result.selectionMethod).toBe('quantum_superposition');
    
    // With deterministic selection, should pick fast-provider (lowest latency)
    expect(result.selected.id).toBe('fast-provider');
  });
  
  it('handles all providers unavailable', async () => {
    // Mock all providers as unreachable
    router.probeProvider = async () => ({
      reachable: false,
      latencyMs: 0,
      error: 'timeout'
    });
    
    const providers = [
      { id: 'provider-1', apiKey: 'key1', baseURL: 'https://api1.com/v1', model: 'model1' },
      { id: 'provider-2', apiKey: 'key2', baseURL: 'https://api2.com/v1', model: 'model2' }
    ];
    
    const result = await router.selectOptimalProvider(providers);
    
    // Should fall back to serial
    expect(result.selectionMethod).toBe('serial_fallback');
    expect(result.selected).toBeDefined();
  });
  
  it('filters providers in cooldown', async () => {
    // Put first provider in cooldown
    router.registerProviders([
      { id: 'cooldown-provider', apiKey: 'key1', baseURL: 'https://api1.com/v1', model: 'model1' }
    ]);
    
    const cooldownState = router.providers.get('cooldown-provider');
    cooldownState.recordFailure();
    
    // Mock probe for available providers
    router.probeProvider = async (providerState) => ({
      reachable: true,
      latencyMs: 200,
      error: null
    });
    
    const providers = [
      { id: 'cooldown-provider', apiKey: 'key1', baseURL: 'https://api1.com/v1', model: 'model1' },
      { id: 'available-provider', apiKey: 'key2', baseURL: 'https://api2.com/v1', model: 'model2' }
    ];
    
    const result = await router.selectOptimalProvider(providers);
    
    // Should not select cooldown provider
    expect(result.selected.id).not.toBe('cooldown-provider');
  });
  
  it('learns from probe history', async () => {
    let callCount = 0;
    
    router.probeProvider = async (providerState) => {
      callCount++;
      // First provider is faster
      return {
        reachable: true,
        latencyMs: providerState.id === 'fast' ? 100 : 500,
        error: null
      };
    };
    
    const providers = [
      { id: 'slow', apiKey: 'key1', baseURL: 'https://slow.api.com/v1', model: 'model1' },
      { id: 'fast', apiKey: 'key2', baseURL: 'https://fast.api.com/v1', model: 'model2' }
    ];
    
    // Run multiple selections
    for (let i = 0; i < 5; i++) {
      await router.selectOptimalProvider(providers);
    }
    
    // Check that fast provider has higher amplitude
    const fastState = router.providers.get('fast');
    const slowState = router.providers.get('slow');
    
    expect(fastState.amplitude).toBeGreaterThan(slowState.amplitude);
    expect(callCount).toBe(10); // 2 providers × 5 selections
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe('Quantum Router Edge Cases', () => {
  let router;
  
  beforeEach(() => {
    router = new QuantumSuperpositionRouter({
      probeCount: 3,
      probeTimeoutMs: 500
    });
  });
  
  afterEach(() => {
    router.resetAll();
  });
  
  it('handles probe timeout gracefully', async () => {
    // Mock slow probe
    router.probeProvider = async () => new Promise((resolve) => {
      setTimeout(() => resolve({
        reachable: true,
        latencyMs: 1000,
        error: null
      }), 2000); // Longer than probeTimeoutMs
    });
    
    const providers = [
      { id: 'provider-1', apiKey: 'key1', baseURL: 'https://api1.com/v1', model: 'model1' }
    ];
    
    // Should not hang - probe has timeout
    const result = await router.selectOptimalProvider(providers);
    
    expect(result).toBeDefined();
  });
  
  it('handles provider with invalid config', async () => {
    router.probeProvider = async () => ({
      reachable: false,
      latencyMs: 0,
      error: 'invalid_config'
    });
    
    const providers = [
      { id: 'bad-provider', apiKey: '', baseURL: 'invalid', model: '' }
    ];
    
    const result = await router.selectOptimalProvider(providers);
    
    expect(result).toBeDefined();
    expect(result.selectionMethod).toBe('serial_fallback');
  });
  
  it('maintains history limit', async () => {
    router.maxHistory = 5;
    
    router.probeProvider = async () => ({
      reachable: true,
      latencyMs: 100,
      error: null
    });
    
    const providers = [
      { id: 'provider-1', apiKey: 'key1', baseURL: 'https://api1.com/v1', model: 'model1' }
    ];
    
    // Run more than maxHistory selections
    for (let i = 0; i < 10; i++) {
      await router.selectOptimalProvider(providers);
    }
    
    expect(router.probeHistory.length).toBeLessThanOrEqual(5);
  });
});
