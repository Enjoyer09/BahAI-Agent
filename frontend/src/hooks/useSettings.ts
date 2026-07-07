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
  const [productMode] = useState<'web_chat' | 'desktop_code'>(() => {
    try {
      return window.navigator.userAgent.includes('Electron') ? 'desktop_code' : 'web_chat';
    } catch {
      return 'web_chat';
    }
  });
  const [executionMode, setExecutionMode] = useState<'cloud' | 'local'>(() => {
    const saved = localStorage.getItem('executionMode');
    if (saved === 'cloud' || saved === 'local') return saved;
    return productMode === 'desktop_code'
      ? (DEFAULT_SETTINGS.executionMode as 'cloud' | 'local')
      : 'cloud';
  });
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
  const [orchestrationMode, setOrchestrationMode] = useState(() => {
    const saved = localStorage.getItem('orchestrationMode');
    if (saved == null) return DEFAULT_SETTINGS.orchestrationMode;
    return saved === 'true';
  });
  const [workflow, setWorkflow] = useState(() => loadSetting('workflow', DEFAULT_SETTINGS.workflow));
  const [guiBrowserMode, setGuiBrowserMode] = useState(() => loadSetting('guiBrowserMode', DEFAULT_SETTINGS.guiBrowserMode));
  const [guiBrowserPath, setGuiBrowserPath] = useState(() => loadSetting('guiBrowserPath', DEFAULT_SETTINGS.guiBrowserPath));
  const [guiBrowserCdpUrl, setGuiBrowserCdpUrl] = useState(() => loadSetting('guiBrowserCdpUrl', DEFAULT_SETTINGS.guiBrowserCdpUrl));
  const [guiAutoStartBrowser, setGuiAutoStartBrowser] = useState(() => localStorage.getItem('guiAutoStartBrowser') === 'true');

  useEffect(() => {
    try {
      const migrationKey = 'guiBrowserModeMigrated_v2';
      if (localStorage.getItem(migrationKey) === 'true') return;
      const savedMode = localStorage.getItem('guiBrowserMode');
      const savedCdpUrl = localStorage.getItem('guiBrowserCdpUrl') || '';
      const savedBrowserPath = localStorage.getItem('guiBrowserPath') || '';
      const looksLikeLegacyDefault = savedMode === 'cdp'
        && (!savedCdpUrl || savedCdpUrl === 'http://127.0.0.1:9222');
      if (looksLikeLegacyDefault) {
        setGuiBrowserMode('persistent');
        if (!savedBrowserPath) {
          localStorage.removeItem('guiBrowserPath');
        }
      }
      localStorage.setItem(migrationKey, 'true');
    } catch {
      // ignore localStorage migration issues
    }
  }, []);

  useEffect(() => {
    if (productMode !== 'desktop_code') return;

    if (executionMode === 'local') {
      setBaseUrl((prev) => prev.includes('11434') ? prev : 'http://localhost:11434/v1');
      setApiKey('ollama');
      setModel((prev) => {
        if (!prev) return 'gemma4:12b';
        if (prev.includes('/') || /^gpt-|^claude|^gemini|^o[134]/i.test(prev)) return 'gemma4:12b';
        return prev;
      });
      return;
    }

    setBaseUrl((prev) => {
      if (prev.includes('11434') || prev.includes('1234')) return 'https://api.freemodel.dev/v1';
      return prev || 'https://api.freemodel.dev/v1';
    });
    setApiKey((prev) => prev === 'ollama' ? '' : prev);
    setModel((prev) => {
      if (!prev || (!prev.includes('/') && !/^gpt-|^claude|^gemini|^o[134]/i.test(prev))) return 'gpt-5.5';
      return prev;
    });
  }, [executionMode, productMode, setApiKey, setBaseUrl, setModel]);

  // Persist to localStorage
  useEffect(() => { localStorage.setItem('executionMode', executionMode); }, [executionMode]);
  useEffect(() => { localStorage.setItem('apiKey', apiKey); }, [apiKey]);
  useEffect(() => { localStorage.setItem('baseUrl', baseUrl); }, [baseUrl]);
  useEffect(() => { localStorage.setItem('model', model); }, [model]);
  useEffect(() => { localStorage.setItem('projectDir', projectDir); }, [projectDir]);
  useEffect(() => { localStorage.setItem('performanceMode', String(performanceMode)); }, [performanceMode]);
  useEffect(() => { localStorage.setItem('orchestrationMode', String(orchestrationMode)); }, [orchestrationMode]);
  useEffect(() => { localStorage.setItem('workflow', workflow); }, [workflow]);
  useEffect(() => { localStorage.setItem('guiBrowserMode', guiBrowserMode); }, [guiBrowserMode]);
  useEffect(() => { localStorage.setItem('guiBrowserPath', guiBrowserPath); }, [guiBrowserPath]);
  useEffect(() => { localStorage.setItem('guiBrowserCdpUrl', guiBrowserCdpUrl); }, [guiBrowserCdpUrl]);
  useEffect(() => { localStorage.setItem('guiAutoStartBrowser', String(guiAutoStartBrowser)); }, [guiAutoStartBrowser]);

  const settings: Settings = { productMode, executionMode, apiKey, baseUrl, model, projectDir, performanceMode, orchestrationMode, workflow, guiBrowserMode, guiBrowserPath, guiBrowserCdpUrl, guiAutoStartBrowser };

  return {
    settings,
    productMode,
    executionMode, setExecutionMode,
    apiKey, setApiKey,
    baseUrl, setBaseUrl,
    model, setModel,
    projectDir, setProjectDir,
    performanceMode, setPerformanceMode,
    orchestrationMode, setOrchestrationMode,
    workflow, setWorkflow,
    guiBrowserMode, setGuiBrowserMode,
    guiBrowserPath, setGuiBrowserPath,
    guiBrowserCdpUrl, setGuiBrowserCdpUrl,
    guiAutoStartBrowser, setGuiAutoStartBrowser,
  };
}

export type ReturnTypeUseSettings = ReturnType<typeof useSettings>;
