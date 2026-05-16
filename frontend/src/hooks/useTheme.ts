import { useState, useEffect } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';

function getSystemTheme(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(mode: ThemeMode) {
  const root = document.documentElement;
  const resolved = mode === 'system' ? getSystemTheme() : mode;
  
  // Set attribute for CSS [data-theme='...']
  root.setAttribute('data-theme', resolved);
  
  // Also keep classes for extra compatibility
  root.classList.remove('light', 'dark');
  root.classList.add(resolved);
}

export function useTheme() {
  const [theme, setTheme] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem('theme') as ThemeMode;
    return saved || 'system';
  });

  useEffect(() => {
    localStorage.setItem('theme', theme);
    applyTheme(theme);
  }, [theme]);

  // Listen for OS theme changes when in system mode
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => { if (theme === 'system') applyTheme('system'); };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  const resolved: 'light' | 'dark' = theme === 'system' ? getSystemTheme() : theme;

  return { theme, setTheme, resolved };
}
