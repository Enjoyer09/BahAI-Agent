// ==========================================
// DesktopIDELayout — Resizable 4-panel IDE grid
// ==========================================
// Layout: [Sidebar | FileTree | Editor+Chat | Preview]
//                              [Terminal]
//
// Used when productMode === 'desktop_code' in the Electron app.

import { useState, useCallback, useRef, type ReactNode } from 'react';

interface PanelConfig {
  fileTree: { visible: boolean; width: number };
  editor: { visible: boolean };
  terminal: { visible: boolean; height: number };
  preview: { visible: boolean; width: number };
}

interface DesktopIDELayoutProps {
  fileTreePanel: ReactNode;
  editorPanel: ReactNode;
  chatPanel: ReactNode;
  terminalPanel: ReactNode;
  previewPanel: ReactNode;
  toolbar?: ReactNode;
}

const DEFAULT_CONFIG: PanelConfig = {
  fileTree: { visible: true, width: 240 },
  editor: { visible: true },
  terminal: { visible: true, height: 200 },
  preview: { visible: false, width: 400 },
};

const STORAGE_KEY = 'bahai-ide-panel-config';

function loadConfig(): PanelConfig {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return { ...DEFAULT_CONFIG, ...JSON.parse(saved) };
  } catch {}
  return DEFAULT_CONFIG;
}

function saveConfig(config: PanelConfig) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {}
}

// Resizable divider component
function ResizeHandle({ direction, onResize }: { direction: 'horizontal' | 'vertical'; onResize: (delta: number) => void }) {
  const handleRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startPos = direction === 'horizontal' ? e.clientX : e.clientY;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const currentPos = direction === 'horizontal' ? moveEvent.clientX : moveEvent.clientY;
      onResize(currentPos - startPos);
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [direction, onResize]);

  return (
    <div
      ref={handleRef}
      onMouseDown={handleMouseDown}
      className={`shrink-0 ${
        direction === 'horizontal'
          ? 'w-1 cursor-col-resize hover:bg-[var(--color-accent)]/30'
          : 'h-1 cursor-row-resize hover:bg-[var(--color-accent)]/30'
      } transition-colors`}
      style={{ background: 'var(--border-subtle)' }}
    />
  );
}

export default function DesktopIDELayout({
  fileTreePanel,
  editorPanel,
  chatPanel,
  terminalPanel,
  previewPanel,
  toolbar,
}: DesktopIDELayoutProps) {
  const [config, setConfig] = useState<PanelConfig>(loadConfig);

  const updateConfig = useCallback((updates: Partial<PanelConfig>) => {
    setConfig(prev => {
      const next = { ...prev, ...updates };
      saveConfig(next);
      return next;
    });
  }, []);

  const handleFileTreeResize = useCallback((delta: number) => {
    setConfig(prev => {
      const newWidth = Math.max(160, Math.min(500, prev.fileTree.width + delta));
      const next = { ...prev, fileTree: { ...prev.fileTree, width: newWidth } };
      saveConfig(next);
      return next;
    });
  }, []);

  const handleTerminalResize = useCallback((delta: number) => {
    setConfig(prev => {
      const newHeight = Math.max(100, Math.min(500, prev.terminal.height - delta));
      const next = { ...prev, terminal: { ...prev.terminal, height: newHeight } };
      saveConfig(next);
      return next;
    });
  }, []);

  const handlePreviewResize = useCallback((delta: number) => {
    setConfig(prev => {
      const newWidth = Math.max(250, Math.min(800, prev.preview.width - delta));
      const next = { ...prev, preview: { ...prev.preview, width: newWidth } };
      saveConfig(next);
      return next;
    });
  }, []);

  return (
    <div className="flex flex-col h-full w-full overflow-hidden" style={{ background: 'var(--bg-main)' }}>
      {/* Toolbar */}
      {toolbar && (
        <div className="shrink-0 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
          {toolbar}
        </div>
      )}

      {/* Main area: horizontal panels */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* FileTree Panel */}
        {config.fileTree.visible && (
          <>
            <div
              className="shrink-0 overflow-hidden flex flex-col"
              style={{
                width: `${config.fileTree.width}px`,
                background: 'var(--bg-surface)',
                borderRight: '1px solid var(--border-subtle)',
              }}
            >
              {fileTreePanel}
            </div>
            <ResizeHandle direction="horizontal" onResize={handleFileTreeResize} />
          </>
        )}

        {/* Center: Editor/Chat + Terminal (vertical split) */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* Top: Editor or Chat */}
          <div className="flex-1 min-h-0 overflow-hidden flex">
            <div className="flex-1 min-w-0 overflow-hidden">
              {config.editor.visible ? editorPanel : chatPanel}
            </div>
          </div>

          {/* Terminal Panel (bottom) */}
          {config.terminal.visible && (
            <>
              <ResizeHandle direction="vertical" onResize={handleTerminalResize} />
              <div
                className="shrink-0 overflow-hidden"
                style={{
                  height: `${config.terminal.height}px`,
                  background: 'var(--bg-surface)',
                  borderTop: '1px solid var(--border-subtle)',
                }}
              >
                {terminalPanel}
              </div>
            </>
          )}
        </div>

        {/* Preview Panel (right) */}
        {config.preview.visible && (
          <>
            <ResizeHandle direction="horizontal" onResize={handlePreviewResize} />
            <div
              className="shrink-0 overflow-hidden flex flex-col"
              style={{
                width: `${config.preview.width}px`,
                background: 'var(--bg-surface)',
                borderLeft: '1px solid var(--border-subtle)',
              }}
            >
              {previewPanel}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export { type PanelConfig, DEFAULT_CONFIG };
