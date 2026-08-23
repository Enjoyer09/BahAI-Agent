import { describe, it, expect, vi } from 'vitest';
import { createProviderRuntime } from '../helpers.js';

describe('provider runtime cooldown recovery', () => {
  it('allows a half-open probe after cooldown even after three failures', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-30T00:00:00Z'));
    const runtime = createProviderRuntime({ providerCooldownMs: 1000 });

    runtime.markProviderFailure('local');
    runtime.markProviderFailure('local');
    runtime.markProviderFailure('local');
    expect(runtime.canUseProviderNow('local')).toBe(false);

    vi.advanceTimersByTime(1001);
    expect(runtime.canUseProviderNow('local')).toBe(true);

    runtime.markProviderSuccess('local');
    expect(runtime.getFailureCount('local')).toBe(0);
    vi.useRealTimers();
  });

  it('applies a standard cooldown to any failing provider and reorders it behind healthy ones', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-01T00:00:00Z'));
    const runtime = createProviderRuntime({ providerCooldownMs: 1000 });
    const primary = { id: 'web_general_primary' };
    const nvidia = { id: 'nvidia_general_1' };

    runtime.markProviderFailure(primary.id, { status: 503 });
    expect(runtime.canUseProviderNow(primary.id)).toBe(false);
    expect(runtime.reorderCandidatesForSession('new-session', [primary, nvidia])[0].id).toBe(nvidia.id);

    // No provider-specific extension: cooldown always equals the configured value.
    vi.advanceTimersByTime(1001);
    expect(runtime.canUseProviderNow(primary.id)).toBe(true);
    vi.useRealTimers();
  });
});
