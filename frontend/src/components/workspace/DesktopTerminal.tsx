// ==========================================
// DesktopTerminal — xterm.js connected to Electron PTY via IPC
// ==========================================
// Real terminal emulator for the Desktop App Builder.
// Falls back to the existing HTTP-based terminal for web mode.

import { useEffect, useRef, useState, useCallback } from 'react';
import { Plus, X, Terminal as TerminalIcon } from 'lucide-react';

interface TerminalSession {
  id: string;
  label: string;
}

interface DesktopTerminalProps {
  projectPath: string;
  isVisible: boolean;
  onClose?: () => void;
}

export default function DesktopTerminal({ projectPath, isVisible, onClose }: DesktopTerminalProps) {
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<any>(null);
  const fitAddonRef = useRef<any>(null);
  const disposeDataRef = useRef<(() => void) | null>(null);
  const disposeExitRef = useRef<(() => void) | null>(null);

  const electron = (window as any).electron;
  const hasPty = Boolean(electron?.terminal);

  // Create a new terminal session
  const createSession = useCallback(async () => {
    if (!hasPty) return;
    try {
      const { terminalId } = await electron.terminal.create(projectPath);
      const label = `Terminal ${sessions.length + 1}`;
      setSessions(prev => [...prev, { id: terminalId, label }]);
      setActiveSessionId(terminalId);
    } catch (err: any) {
      console.error('[DesktopTerminal] Failed to create session:', err);
    }
  }, [hasPty, electron, projectPath, sessions.length]);

  // Kill a terminal session
  const killSession = useCallback(async (id: string) => {
    if (!hasPty) return;
    try {
      await electron.terminal.kill(id);
    } catch {}
    setSessions(prev => prev.filter(s => s.id !== id));
    setActiveSessionId(prev => prev === id ? (sessions[0]?.id || null) : prev);
  }, [hasPty, electron, sessions]);

  // Initialize xterm.js (dynamically imported)
  useEffect(() => {
    if (!isVisible || !activeSessionId || !containerRef.current) return;

    let disposed = false;

    async function initXterm() {
      // Dynamic import to avoid bundling xterm when not needed
      const { Terminal } = await import('xterm');
      const { FitAddon } = await import('@xterm/addon-fit');

      if (disposed || !containerRef.current) return;

      // Clean up previous instance
      if (xtermRef.current) {
        xtermRef.current.dispose();
      }

      const term = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', Monaco, monospace",
        theme: {
          background: '#1a1a1a',
          foreground: '#e0e0e0',
          cursor: '#7F77DD',
          selectionBackground: 'rgba(127, 119, 221, 0.3)',
        },
        allowProposedApi: true,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);

      term.open(containerRef.current!);
      fitAddon.fit();

      xtermRef.current = term;
      fitAddonRef.current = fitAddon;

      // Wire input: user types → send to PTY
      term.onData((data: string) => {
        electron.terminal.write(activeSessionId, data);
      });

      // Wire output: PTY data → render in xterm
      if (disposeDataRef.current) disposeDataRef.current();
      disposeDataRef.current = electron.terminal.onData((payload: { id: string; data: string }) => {
        if (payload.id === activeSessionId && xtermRef.current) {
          xtermRef.current.write(payload.data);
        }
      });

      // Wire exit
      if (disposeExitRef.current) disposeExitRef.current();
      disposeExitRef.current = electron.terminal.onExit((payload: { id: string; exitCode: number }) => {
        if (payload.id === activeSessionId && xtermRef.current) {
          xtermRef.current.write(`\r\n[Process exited with code ${payload.exitCode}]\r\n`);
        }
      });

      // Handle resize
      const resizeObserver = new ResizeObserver(() => {
        if (fitAddonRef.current && xtermRef.current) {
          fitAddonRef.current.fit();
          const { cols, rows } = xtermRef.current;
          electron.terminal.resize(activeSessionId, cols, rows);
        }
      });
      resizeObserver.observe(containerRef.current!);

      return () => {
        resizeObserver.disconnect();
      };
    }

    initXterm();

    return () => {
      disposed = true;
      if (disposeDataRef.current) { disposeDataRef.current(); disposeDataRef.current = null; }
      if (disposeExitRef.current) { disposeExitRef.current(); disposeExitRef.current = null; }
      if (xtermRef.current) { xtermRef.current.dispose(); xtermRef.current = null; }
    };
  }, [isVisible, activeSessionId, electron]);

  // Auto-create first session
  useEffect(() => {
    if (isVisible && hasPty && sessions.length === 0) {
      createSession();
    }
  }, [isVisible, hasPty, sessions.length, createSession]);

  if (!isVisible) return null;

  // Fallback for non-Electron (web mode)
  if (!hasPty) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-[var(--fg-muted)]">
        Terminal yalnız Desktop versiyasında mövcuddur.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: '#1a1a1a' }}>
      {/* Tab bar */}
      <div className="flex items-center shrink-0 px-2 gap-1" style={{ background: 'var(--bg-surface)', borderBottom: '1px solid var(--border-subtle)', height: '32px' }}>
        {sessions.map(s => (
          <div
            key={s.id}
            onClick={() => setActiveSessionId(s.id)}
            className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] cursor-pointer transition-colors ${
              s.id === activeSessionId ? 'bg-[var(--bg-active)] text-[var(--fg-main)]' : 'text-[var(--fg-muted)] hover:text-[var(--fg-main)]'
            }`}
          >
            <TerminalIcon size={10} />
            <span>{s.label}</span>
            <button
              onClick={(e) => { e.stopPropagation(); killSession(s.id); }}
              className="ml-1 opacity-50 hover:opacity-100"
            >
              <X size={9} />
            </button>
          </div>
        ))}
        {sessions.length < 4 && (
          <button onClick={createSession} className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--fg-muted)]" title="Yeni terminal">
            <Plus size={12} />
          </button>
        )}
        <div className="flex-1" />
        {onClose && (
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--fg-muted)]" title="Bağla">
            <X size={12} />
          </button>
        )}
      </div>

      {/* Terminal container */}
      <div ref={containerRef} className="flex-1 min-h-0 overflow-hidden px-1 py-1" />
    </div>
  );
}
