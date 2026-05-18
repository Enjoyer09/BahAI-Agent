import { useState, useEffect, useRef, memo } from 'react';
import { Terminal as TerminalIcon, Trash2, X } from 'lucide-react';

interface LogEntry {
  id: string;
  type: 'info' | 'error' | 'success' | 'command';
  content: string;
  timestamp: string;
}

interface Props {
  projectPath: string;
  isVisible: boolean;
  onClose: () => void;
}

const LogRow = memo(({ log }: { log: LogEntry }) => {
  const colors: Record<string, string> = {
    error: 'var(--color-danger)',
    success: 'var(--color-success)',
    command: 'var(--color-accent)',
    info: 'var(--fg-secondary)',
  };

  return (
    <div className="flex gap-2 py-0.5">
      <span className="shrink-0 text-[10px] font-mono" style={{ color: 'var(--fg-muted)', opacity: 0.5 }}>
        {log.timestamp}
      </span>
      <span className="break-words text-xs font-mono" style={{ color: colors[log.type] || colors.info }}>
        {log.type === 'command' && <span style={{ color: 'var(--fg-muted)' }}>$ </span>}
        {log.content}
      </span>
    </div>
  );
});

LogRow.displayName = 'LogRow';

export default function Terminal({ projectPath, isVisible, onClose }: Props) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleLog = (e: CustomEvent) => {
      const timeStr = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const newLog: LogEntry = {
        id: crypto.randomUUID(),
        type: e.detail?.type || 'info',
        content: e.detail?.content || '',
        timestamp: timeStr,
      };
      setLogs(prev => [...prev.slice(-200), newLog]);
    };
    window.addEventListener('terminal-log', handleLog as EventListener);
    return () => window.removeEventListener('terminal-log', handleLog as EventListener);
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  if (!isVisible) return null;

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--bg-surface)' }}>
      {/* Header */}
      <div
        className="h-9 flex items-center justify-between px-3 shrink-0"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-1.5">
          <TerminalIcon size={13} style={{ color: 'var(--color-accent)' }} />
          <span className="text-[11px] font-medium" style={{ color: 'var(--fg-secondary)' }}>Terminal</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setLogs([])}
            className="p-1 rounded transition-colors"
            style={{ color: 'var(--fg-muted)' }}
            title="Clear"
            aria-label="Clear terminal"
          >
            <Trash2 size={12} />
          </button>
          <button
            onClick={onClose}
            className="p-1 rounded transition-colors"
            style={{ color: 'var(--fg-muted)' }}
            aria-label="Close terminal"
          >
            <X size={12} />
          </button>
        </div>
      </div>

      {/* Log output */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto premium-scroll p-3"
        style={{ background: 'var(--bg-main)' }}
      >
        {logs.length === 0 ? (
          <div className="text-xs italic" style={{ color: 'var(--fg-muted)' }}>
            Waiting for output...
          </div>
        ) : (
          logs.map(log => <LogRow key={log.id} log={log} />)
        )}
      </div>
    </div>
  );
}
