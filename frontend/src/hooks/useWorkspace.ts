// ==========================================
// useWorkspace — Desktop workspace state management
// ==========================================
// Manages: file tree, editor tabs, terminals, git state, dev server, panel layout.

import { useState, useCallback, useEffect, useRef } from 'react';
import type { FileNode, EditorTab } from '../components/workspace';
import { createTab } from '../components/workspace';

interface GitState {
  branch: string;
  files: Record<string, string>;
  error?: string;
}

interface DevServerState {
  port: number | null;
  status: 'stopped' | 'starting' | 'running' | 'error';
}

interface PanelLayout {
  fileTree: boolean;
  terminal: boolean;
  preview: boolean;
}

interface UseWorkspaceReturn {
  // File tree
  fileTree: FileNode[];
  refreshFileTree: () => Promise<void>;
  
  // Editor tabs
  openTabs: EditorTab[];
  activeTab: EditorTab | null;
  openFile: (path: string) => void;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  markTabDirty: (tabId: string, dirty: boolean) => void;

  // Git
  gitState: GitState;
  refreshGitStatus: () => Promise<void>;

  // Dev server
  devServer: DevServerState;
  setDevServerPort: (port: number | null) => void;

  // Panel layout
  panelLayout: PanelLayout;
  togglePanel: (panel: keyof PanelLayout) => void;

  // File change signal (for preview auto-reload)
  fileChangeSignal: number;
}

const MAX_TABS = 12;
const LAYOUT_STORAGE_KEY = 'bahai-workspace-layout';

function loadLayout(): PanelLayout {
  try {
    const saved = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch {}
  return { fileTree: true, terminal: true, preview: false };
}

function saveLayout(layout: PanelLayout) {
  try { localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout)); } catch {}
}

export function useWorkspace(workingDirectory: string): UseWorkspaceReturn {
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [openTabs, setOpenTabs] = useState<EditorTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [gitState, setGitState] = useState<GitState>({ branch: '', files: {} });
  const [devServer, setDevServer] = useState<DevServerState>({ port: null, status: 'stopped' });
  const [panelLayout, setPanelLayout] = useState<PanelLayout>(loadLayout);
  const [fileChangeSignal, setFileChangeSignal] = useState(0);
  const gitTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ─── File Tree ─────────────────────────────────
  const refreshFileTree = useCallback(async () => {
    if (!workingDirectory || workingDirectory.startsWith('workspace://')) return;
    try {
      const electron = (window as any).electron;
      if (electron?.fs?.readDirectory) {
        const nodes = await electron.fs.readDirectory(workingDirectory, 3);
        setFileTree(nodes);
      }
    } catch (err) {
      console.error('[useWorkspace] refreshFileTree error:', err);
    }
  }, [workingDirectory]);

  // Initial load + file watcher
  useEffect(() => {
    if (!workingDirectory || workingDirectory.startsWith('workspace://')) return;
    refreshFileTree();

    const electron = (window as any).electron;
    if (!electron?.fs?.onBatchChanged) return;

    electron.fs.watchStart(workingDirectory).catch(() => {});
    const dispose = electron.fs.onBatchChanged(() => {
      refreshFileTree();
      setFileChangeSignal(s => s + 1);
    });

    return () => {
      dispose();
      electron.fs.watchStop().catch(() => {});
    };
  }, [workingDirectory, refreshFileTree]);

  // ─── Editor Tabs ───────────────────────────────
  const openFile = useCallback((filePath: string) => {
    setOpenTabs(prev => {
      const existing = prev.find(t => t.filePath === filePath);
      if (existing) {
        setActiveTabId(existing.id);
        return prev;
      }
      // LRU eviction if at max
      const tabs = prev.length >= MAX_TABS ? prev.slice(1) : prev;
      const newTab = createTab(filePath);
      setActiveTabId(newTab.id);
      return [...tabs, newTab];
    });
  }, []);

  const closeTab = useCallback((tabId: string) => {
    setOpenTabs(prev => {
      const filtered = prev.filter(t => t.id !== tabId);
      if (activeTabId === tabId) {
        const idx = prev.findIndex(t => t.id === tabId);
        const nextActive = filtered[Math.min(idx, filtered.length - 1)];
        setActiveTabId(nextActive?.id || null);
      }
      return filtered;
    });
  }, [activeTabId]);

  const markTabDirty = useCallback((tabId: string, dirty: boolean) => {
    setOpenTabs(prev => prev.map(t => t.id === tabId ? { ...t, isDirty: dirty } : t));
  }, []);

  const activeTab = openTabs.find(t => t.id === activeTabId) || null;

  // ─── Git Status ────────────────────────────────
  const refreshGitStatus = useCallback(async () => {
    if (!workingDirectory || workingDirectory.startsWith('workspace://')) return;
    const electron = (window as any).electron;
    if (!electron?.git?.status) return;
    try {
      const result = await electron.git.status(workingDirectory);
      setGitState({ branch: result.branch || '', files: result.files || {}, error: result.error });
    } catch {
      setGitState(prev => ({ ...prev, error: 'Git status yoxlanıla bilmədi' }));
    }
  }, [workingDirectory]);

  // Periodic git refresh (every 10s)
  useEffect(() => {
    if (!workingDirectory || workingDirectory.startsWith('workspace://')) return;
    refreshGitStatus();
    gitTimerRef.current = setInterval(refreshGitStatus, 10000);
    return () => {
      if (gitTimerRef.current) clearInterval(gitTimerRef.current);
    };
  }, [workingDirectory, refreshGitStatus]);

  // ─── Dev Server ────────────────────────────────
  const setDevServerPort = useCallback((port: number | null) => {
    setDevServer({ port, status: port ? 'running' : 'stopped' });
  }, []);

  // ─── Panel Layout ──────────────────────────────
  const togglePanel = useCallback((panel: keyof PanelLayout) => {
    setPanelLayout(prev => {
      const next = { ...prev, [panel]: !prev[panel] };
      saveLayout(next);
      return next;
    });
  }, []);

  // ─── Cleanup on project switch ─────────────────
  useEffect(() => {
    // Reset state when working directory changes
    setOpenTabs([]);
    setActiveTabId(null);
    setGitState({ branch: '', files: {} });
    setDevServer({ port: null, status: 'stopped' });
    setFileChangeSignal(0);
  }, [workingDirectory]);

  return {
    fileTree,
    refreshFileTree,
    openTabs,
    activeTab,
    openFile,
    closeTab,
    setActiveTab: setActiveTabId,
    markTabDirty,
    gitState,
    refreshGitStatus,
    devServer,
    setDevServerPort,
    panelLayout,
    togglePanel,
    fileChangeSignal,
  };
}
