// ==========================================
// providerHealth circuit breaker tests
// ==========================================
import { describe, it, expect, vi } from 'vitest';
import { createProviderHealth } from '../jobs/providerHealth';

describe('providerHealth circuit breaker', () => {
  it('starts closed and is not open', () => {
    const h = createProviderHealth({ db: null, env: { BREAKER_FAILURE_THRESHOLD: '2', BREAKER_COOLDOWN_MS: '1000' } });
    expect(h.isOpen('p1')).toBe(false);
    expect(h.state('p1').circuitState).toBe('closed');
  });

  it('opens after consecutive failures reach the threshold', () => {
    const h = createProviderHealth({ db: null, env: { BREAKER_FAILURE_THRESHOLD: '2', BREAKER_COOLDOWN_MS: '1000' } });
    h.recordFailure('p1', { error: { status: 500 } });
    expect(h.isOpen('p1')).toBe(false); // 1 failure, still closed
    h.recordFailure('p1', { error: { status: 500 } });
    expect(h.isOpen('p1')).toBe(true);  // 2 failures -> open
    expect(h.state('p1').circuitState).toBe('open');
  });

  it('transitions open -> half_open -> closed across the cooldown', () => {
    // NOTE: cooldown is floored to >=1000ms in createProviderHealth (a deliberate
    // guardrail so a misconfigured tiny cooldown can't hammer a degraded provider),
    // so BREAKER_COOLDOWN_MS:'50' is clamped to 1000ms and we wait past it.
    const h = createProviderHealth({ db: null, env: { BREAKER_FAILURE_THRESHOLD: '2', BREAKER_COOLDOWN_MS: '50' } });
    h.recordFailure('p1', { error: { status: 500 } });
    h.recordFailure('p1', { error: { status: 500 } });
    expect(h.isOpen('p1')).toBe(true);
    // After cooldown the next check flips to half-open and allows one trial.
    return new Promise((resolve) => {
      setTimeout(() => {
        expect(h.isOpen('p1')).toBe(false); // half-open trial allowed
        expect(h.state('p1').circuitState).toBe('half_open');
        h.recordSuccess('p1', { status: 200 });
        expect(h.isOpen('p1')).toBe(false);
        expect(h.state('p1').circuitState).toBe('closed');
        expect(h.state('p1').consecutiveFailures).toBe(0);
        resolve();
      }, 1100);
    });
  });

  it('does not trip on cancellation/abort errors', () => {
    const h = createProviderHealth({ db: null, env: { BREAKER_FAILURE_THRESHOLD: '1', BREAKER_COOLDOWN_MS: '1000' } });
    h.recordFailure('p1', { error: { name: 'AbortError', message: 'cancelled' } });
    expect(h.state('p1').consecutiveFailures).toBe(0);
    expect(h.isOpen('p1')).toBe(false);
  });

  it('tracks EWMA latency on success', () => {
    const h = createProviderHealth({ db: null, env: {} });
    h.recordSuccess('p1', { status: 200, latencyMs: 100 });
    h.recordSuccess('p1', { status: 200, latencyMs: 200 });
    expect(h.state('p1').ewmaLatencyMs).toBeGreaterThan(100);
    expect(h.state('p1').ewmaLatencyMs).toBeLessThan(200);
  });

  it('persists state to the provider_health table when db is provided', () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const h = createProviderHealth({ db: { query }, env: { BREAKER_FAILURE_THRESHOLD: '1', BREAKER_COOLDOWN_MS: '1000' } });
    h.recordFailure('p1', { error: { status: 500 } });
    expect(query).toHaveBeenCalled();
    const call = query.mock.calls.find((c) => c[0].includes('INSERT INTO provider_health'));
    expect(call).toBeTruthy();
  });
});
