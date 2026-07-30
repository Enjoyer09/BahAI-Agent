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
});
