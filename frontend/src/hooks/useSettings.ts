// ==========================================
// useSettings Hook — localStorage persistence
// ==========================================

import { useState, useEffect } from 'react';
import type { Settings } from '../lib/types';
import { DEFAULT_BASE_URL } from '../lib/constants';

function loadSetting(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

export function useSettings() {
  const [apiKey, setApiKey] = useState(() => loadSetting('apiKey', ''));
  const [baseUrl, setBaseUrl] = useState(() => loadSetting('baseUrl', DEFAULT_BASE_URL));
  const [model, setModel] = useState(() => loadSetting('model', 'meta/llama-3.3-70b-instruct'));
  const [projectDir, setProjectDir] = useState(() => loadSetting('projectDir', ''));
  const [performanceMode, setPerformanceMode] = useState(() => {
    return localStorage.getItem('performanceMode') === 'true';
  });

  // Persist to localStorage
  useEffect(() => { localStorage.setItem('apiKey', apiKey); }, [apiKey]);
  useEffect(() => { localStorage.setItem('baseUrl', baseUrl); }, [baseUrl]);
  useEffect(() => { localStorage.setItem('model', model); }, [model]);
  useEffect(() => { localStorage.setItem('projectDir', projectDir); }, [projectDir]);
  useEffect(() => { localStorage.setItem('performanceMode', String(performanceMode)); }, [performanceMode]);

  const settings: Settings = { apiKey, baseUrl, model, projectDir, performanceMode, setProjectDir };

  return {
    settings,
    apiKey, setApiKey,
    baseUrl, setBaseUrl,
    model, setModel,
    projectDir, setProjectDir,
    performanceMode, setPerformanceMode,
  };
}
