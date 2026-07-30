// ==========================================
// useSettings Hook — localStorage persistence
// ==========================================

import { useCallback, useState, useEffect } from 'react';
import type { Settings } from '../lib/types';
import { DEFAULT_BASE_URL, DEFAULT_SETTINGS } from '../lib/constants';

function loadSetting(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function loadBoolSetting(key: string, fallback: boolean): boolean {
  try {
    const val = localStorage.getItem(key);
    if (val === null) return fallback;
    return val === 'true';
  } catch {
    return fallback;
  }
}

export function useSettings() {
  const [productMode] = useState<'web_chat' | 'desktop_code'>(() => {
    try {
      return (window as any).electron?.isDesktop || window.navigator.userAgent.includes('Electron')
        ? 'desktop_code'
        : 'web_chat';
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
    if (productMode === 'web_chat') return false;
    const saved = localStorage.getItem('orchestrationMode');
    if (saved == null) return DEFAULT_SETTINGS.orchestrationMode;
    return saved === 'true';
  });
  const [workflow, setWorkflow] = useState(() => loadSetting('workflow', DEFAULT_SETTINGS.workflow));
  const [customInstructions, setCustomInstructions] = useState(() => loadSetting('customInstructions', DEFAULT_SETTINGS.customInstructions));
  const [guiBrowserMode, setGuiBrowserMode] = useState(() => loadSetting('guiBrowserMode', DEFAULT_SETTINGS.guiBrowserMode));
  const [guiBrowserPath, setGuiBrowserPath] = useState(() => loadSetting('guiBrowserPath', DEFAULT_SETTINGS.guiBrowserPath));
  const [guiBrowserCdpUrl, setGuiBrowserCdpUrl] = useState(() => loadSetting('guiBrowserCdpUrl', DEFAULT_SETTINGS.guiBrowserCdpUrl));
  const [guiAutoStartBrowser, setGuiAutoStartBrowser] = useState(() => loadBoolSetting('guiAutoStartBrowser', false));
  const [aiMode, setAiModeState] = useState<'smart' | 'manual'>(() => {
    if (productMode === 'web_chat') return 'smart';
    const saved = loadSetting('aiMode', DEFAULT_SETTINGS.aiMode);
    return saved === 'manual' ? 'manual' : 'smart';
  });
  const setAiMode = useCallback((mode: 'smart' | 'manual') => {
    setAiModeState(productMode === 'web_chat' ? 'smart' : mode);
  }, [productMode]);

  // Appearance & Layout Settings
  const [language, setLanguage] = useState(() => loadSetting('language', 'en'));
  const [messageFontSize, setMessageFontSize] = useState(() => loadSetting('messageFontSize', 'medium'));
  const [chatDirection, setChatDirection] = useState<'ltr' | 'rtl'>(() => loadSetting('chatDirection', 'ltr') as 'ltr' | 'rtl');
  const [maximizeChatSpace, setMaximizeChatSpace] = useState(() => loadBoolSetting('maximizeChatSpace', false));
  const [centerChatInput, setCenterChatInput] = useState(() => loadBoolSetting('centerChatInput', true));
  const [scrollToEndButton, setScrollToEndButton] = useState(() => loadBoolSetting('scrollToEndButton', true));

  // Accessibility
  const [keepScreenAwake, setKeepScreenAwake] = useState(() => loadBoolSetting('keepScreenAwake', false));

  // Chat preferences
  const [enterToSend, setEnterToSend] = useState(() => loadBoolSetting('enterToSend', true));
  const [enableMarkdown, setEnableMarkdown] = useState(() => loadBoolSetting('enableMarkdown', true));
  const [showThinking, setShowThinking] = useState(() => loadBoolSetting('showThinking', true));
  const [autoScroll, setAutoScroll] = useState(() => loadBoolSetting('autoScroll', true));

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
    if (productMode === 'web_chat' && orchestrationMode) {
      setOrchestrationMode(false);
    }
  }, [productMode, orchestrationMode]);

  useEffect(() => {
    if (productMode === 'web_chat' && aiMode !== 'smart') {
      setAiModeState('smart');
    }
  }, [aiMode, productMode]);

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
  useEffect(() => { localStorage.setItem('orchestrationMode', String(productMode === 'web_chat' ? false : orchestrationMode)); }, [orchestrationMode, productMode]);
  useEffect(() => { localStorage.setItem('workflow', workflow); }, [workflow]);
  useEffect(() => { localStorage.setItem('customInstructions', customInstructions); }, [customInstructions]);
  useEffect(() => { localStorage.setItem('guiBrowserMode', guiBrowserMode); }, [guiBrowserMode]);
  useEffect(() => { localStorage.setItem('guiBrowserPath', guiBrowserPath); }, [guiBrowserPath]);
  useEffect(() => { localStorage.setItem('guiBrowserCdpUrl', guiBrowserCdpUrl); }, [guiBrowserCdpUrl]);
  useEffect(() => { localStorage.setItem('guiAutoStartBrowser', String(guiAutoStartBrowser)); }, [guiAutoStartBrowser]);
  useEffect(() => {
    localStorage.setItem('aiMode', productMode === 'web_chat' ? 'smart' : aiMode);
  }, [aiMode, productMode]);
  
  useEffect(() => { localStorage.setItem('language', language); }, [language]);
  useEffect(() => { localStorage.setItem('messageFontSize', messageFontSize); }, [messageFontSize]);
  useEffect(() => { localStorage.setItem('chatDirection', chatDirection); }, [chatDirection]);
  useEffect(() => { localStorage.setItem('maximizeChatSpace', String(maximizeChatSpace)); }, [maximizeChatSpace]);
  useEffect(() => { localStorage.setItem('centerChatInput', String(centerChatInput)); }, [centerChatInput]);
  useEffect(() => { localStorage.setItem('scrollToEndButton', String(scrollToEndButton)); }, [scrollToEndButton]);
  useEffect(() => { localStorage.setItem('keepScreenAwake', String(keepScreenAwake)); }, [keepScreenAwake]);
  useEffect(() => { localStorage.setItem('enterToSend', String(enterToSend)); }, [enterToSend]);
  useEffect(() => { localStorage.setItem('enableMarkdown', String(enableMarkdown)); }, [enableMarkdown]);
  useEffect(() => { localStorage.setItem('showThinking', String(showThinking)); }, [showThinking]);
  useEffect(() => { localStorage.setItem('autoScroll', String(autoScroll)); }, [autoScroll]);
  useEffect(() => {
    document.documentElement.dataset.performanceMode = performanceMode ? 'on' : 'off';
    document.body.dataset.performanceMode = performanceMode ? 'on' : 'off';
    return () => {
      delete document.documentElement.dataset.performanceMode;
      delete document.body.dataset.performanceMode;
    };
  }, [performanceMode]);

  const settings: Settings = { 
    productMode, executionMode, apiKey, baseUrl, model, projectDir, performanceMode, orchestrationMode, workflow, 
    customInstructions, guiBrowserMode, guiBrowserPath, guiBrowserCdpUrl, guiAutoStartBrowser, aiMode,
    language, messageFontSize, chatDirection, maximizeChatSpace, centerChatInput, scrollToEndButton,
    keepScreenAwake, enterToSend, enableMarkdown, showThinking, autoScroll
  };

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
    customInstructions, setCustomInstructions,
    guiBrowserMode, setGuiBrowserMode,
    guiBrowserPath, setGuiBrowserPath,
    guiBrowserCdpUrl, setGuiBrowserCdpUrl,
    guiAutoStartBrowser, setGuiAutoStartBrowser,
    aiMode, setAiMode,
    language, setLanguage,
    messageFontSize, setMessageFontSize,
    chatDirection, setChatDirection,
    maximizeChatSpace, setMaximizeChatSpace,
    centerChatInput, setCenterChatInput,
    scrollToEndButton, setScrollToEndButton,
    keepScreenAwake, setKeepScreenAwake,
    enterToSend, setEnterToSend,
    enableMarkdown, setEnableMarkdown,
    showThinking, setShowThinking,
    autoScroll, setAutoScroll,
  };
}

export type ReturnTypeUseSettings = ReturnType<typeof useSettings>;
