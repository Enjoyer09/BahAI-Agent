// ==========================================
// useTheme Hook Tests
// ==========================================

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTheme } from './useTheme';

describe('useTheme', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns system as default theme when nothing is saved', () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('system');
  });

  it('loads saved theme from localStorage', () => {
    localStorage.setItem('theme', 'dark');
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('dark');
  });

  it('loads light theme from localStorage', () => {
    localStorage.setItem('theme', 'light');
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('light');
  });

  it('sets theme and persists to localStorage', () => {
    const { result } = renderHook(() => useTheme());

    act(() => {
      result.current.setTheme('dark');
    });

    expect(result.current.theme).toBe('dark');
    expect(localStorage.getItem('theme')).toBe('dark');
  });

  it('switches between all theme modes', () => {
    const { result } = renderHook(() => useTheme());

    act(() => result.current.setTheme('light'));
    expect(result.current.theme).toBe('light');
    expect(result.current.resolved).toBe('light');

    act(() => result.current.setTheme('dark'));
    expect(result.current.theme).toBe('dark');
    expect(result.current.resolved).toBe('dark');

    act(() => result.current.setTheme('system'));
    expect(result.current.theme).toBe('system');
  });

  it('sets data-theme attribute on documentElement', () => {
    const { result } = renderHook(() => useTheme());

    act(() => result.current.setTheme('light'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');

    act(() => result.current.setTheme('dark'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('toggle from dark to light', () => {
    const { result } = renderHook(() => useTheme());

    act(() => result.current.setTheme('dark'));
    expect(result.current.resolved).toBe('dark');

    act(() => result.current.setTheme('light'));
    expect(result.current.resolved).toBe('light');
  });

  it('resolved returns system preference when in system mode', () => {
    // Mock matchMedia to return dark mode
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: query.includes('dark'),
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });

    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('system');
    // System is dark based on mock
    expect(result.current.resolved).toBe('dark');
  });
});
