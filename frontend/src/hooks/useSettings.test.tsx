import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useSettings } from './useSettings';

function resetEnvironment() {
  localStorage.clear();
  delete (window as any).electron;
}

beforeEach(resetEnvironment);
afterEach(resetEnvironment);

describe('useSettings product boundaries', () => {
  it('uses the preload bridge as the authoritative desktop signal', () => {
    (window as any).electron = { isDesktop: true };
    localStorage.setItem('aiMode', 'manual');

    const { result } = renderHook(() => useSettings());

    expect(result.current.productMode).toBe('desktop_code');
    expect(result.current.aiMode).toBe('manual');
  });

  it('forces Smart routing in web mode even with stale manual storage', () => {
    localStorage.setItem('aiMode', 'manual');

    const { result } = renderHook(() => useSettings());
    act(() => result.current.setAiMode('manual'));

    expect(result.current.productMode).toBe('web_chat');
    expect(result.current.aiMode).toBe('smart');
    expect(localStorage.getItem('aiMode')).toBe('smart');
  });

  it('keeps Manual mode available in desktop', () => {
    (window as any).electron = { isDesktop: true };
    const { result } = renderHook(() => useSettings());

    act(() => result.current.setAiMode('manual'));

    expect(result.current.aiMode).toBe('manual');
  });
});
