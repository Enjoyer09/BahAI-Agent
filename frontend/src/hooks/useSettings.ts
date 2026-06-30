// ==========================================
// useSettings Hook — localStorage persistence
// ==========================================

import { useState, useEffect } from 'react';
import type { Settings } from '../lib/types';
import { DEFAULT_BASE_URL, DEFAULT_SETTINGS } from '../lib/constants';

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
  // FUNC-FIX: default model now uses DEFAULT_SETTINGS so it matches an actual
  // entry in MODELS. Previously hard-coded `'deepseek-v4-flash-free'` (no
  // slash, no colon) and the dropdown never highlighted the current model.
  const [model, setModel] = useState(() => loadSetting('model', DEFAULT_SETTINGS.model));
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

  const settings: Settings = { apiKey, baseUrl, model, projectDir, performanceMode };

  return {
    settings,
    apiKey, setApiKey,
    baseUrl, setBaseUrl,
    model, setModel,
    projectDir, setProjectDir,
    performanceMode, setPerformanceMode,
  };
}
