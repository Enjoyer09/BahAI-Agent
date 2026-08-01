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

  it('keeps OmniRoute 503 failures on a longer global cooldown and reorders it behind healthy providers', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-01T00:00:00Z'));
    const runtime = createProviderRuntime({ providerCooldownMs: 1000 });
    const omni = { id: 'web_general_primary_omniroute' };
    const nvidia = { id: 'nvidia_general_1' };

    runtime.markProviderFailure(omni.id, { status: 503 });
    expect(runtime.canUseProviderNow(omni.id)).toBe(false);
    expect(runtime.reorderCandidatesForSession('new-session', [omni, nvidia])[0].id).toBe(nvidia.id);

    vi.advanceTimersByTime(60000);
    expect(runtime.canUseProviderNow(omni.id)).toBe(false);
    vi.advanceTimersByTime(60001);
    expect(runtime.canUseProviderNow(omni.id)).toBe(true);
    vi.useRealTimers();
  });
});
