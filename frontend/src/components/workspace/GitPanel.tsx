// ==========================================
// GitPanel — Git status, branch, commit history
// ==========================================

import { useState, useEffect, useCallback } from 'react';
import { GitBranch, GitCommit, RefreshCcw, Upload, CheckCircle2, Circle, Trash2 } from 'lucide-react';

interface GitFile {
  path: string;
  status: string;
}

interface GitLogEntry {
  hash: string;
  author: string;
  date: string;
  message: string;
}

interface GitPanelProps {
  workingDirectory: string;
  branch: string;
  files: Record<string, string>;
  onRefresh: () => void;
}

export default function GitPanel({ workingDirectory, branch, files, onRefresh }: GitPanelProps) {
  const [log, setLog] = useState<GitLogEntry[]>([]);
  const [activeView, setActiveView] = useState<'changes' | 'history'>('changes');

  const electron = (window as any).electron;

  const loadLog = useCallback(async () => {
    if (!electron?.git?.log || !workingDirectory) return;
    try {
      const entries = await electron.git.log(workingDirectory, 15);
      setLog(entries);
    } catch {}
  }, [electron, workingDirectory]);

  useEffect(() => {
    if (activeView === 'history') loadLog();
  }, [activeView, loadLog]);

  const changedFiles = Object.entries(files).map(([path, status]) => ({ path, status }));
  const hasChanges = changedFiles.length > 0;

  const statusIcon = (status: string) => {
    switch (status) {
      case 'modified': return <Circle size={8} fill="var(--color-warning)" className="text-[var(--color-warning)]" />;
      case 'added': return <Circle size={8} fill="var(--color-success)" className="text-[var(--color-success)]" />;
      case 'deleted': return <Trash2 size={8} className="text-[var(--color-danger)]" />;
      case 'untracked': return <Circle size={8} className="text-[var(--fg-muted)]" />;
      default: return <Circle size={8} className="text-[var(--fg-muted)]" />;
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
        <div className="flex items-center gap-2">
          <GitBranch size={13} className="text-[var(--color-accent)]" />
          <span className="text-[11px] font-semibold text-[var(--fg-main)]">{branch || 'no branch'}</span>
        </div>
        <button onClick={onRefresh} className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--fg-muted)]" title="Yenilə">
          <RefreshCcw size={11} />
        </button>
      </div>

      {/* View switcher */}
      <div className="shrink-0 flex border-b" style={{ borderColor: 'var(--border-subtle)' }}>
        <button
          onClick={() => setActiveView('changes')}
          className={`flex-1 py-1.5 text-[10px] font-semibold uppercase tracking-wider transition-colors ${
            activeView === 'changes' ? 'text-[var(--color-accent)] border-b-2 border-[var(--color-accent)]' : 'text-[var(--fg-muted)]'
          }`}
        >
          Dəyişikliklər {hasChanges ? `(${changedFiles.length})` : ''}
        </button>
        <button
          onClick={() => setActiveView('history')}
          className={`flex-1 py-1.5 text-[10px] font-semibold uppercase tracking-wider transition-colors ${
            activeView === 'history' ? 'text-[var(--color-accent)] border-b-2 border-[var(--color-accent)]' : 'text-[var(--fg-muted)]'
          }`}
        >
          Tarixçə
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto premium-scroll">
        {activeView === 'changes' ? (
          !hasChanges ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-center px-4">
              <CheckCircle2 size={20} className="text-[var(--color-success)]" />
              <span className="text-[11px] text-[var(--fg-muted)]">Dəyişiklik yoxdur</span>
            </div>
          ) : (
            <div className="py-1">
              {changedFiles.map(f => (
                <div key={f.path} className="flex items-center gap-2 px-3 py-1 hover:bg-[var(--bg-hover)] text-[11px]">
                  {statusIcon(f.status)}
                  <span className="flex-1 truncate text-[var(--fg-main)]">{f.path}</span>
                  <span className="text-[9px] uppercase font-bold text-[var(--fg-muted)]">{f.status[0]}</span>
                </div>
              ))}
            </div>
          )
        ) : (
          log.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <span className="text-[11px] text-[var(--fg-muted)]">Commit tarixçəsi boşdur</span>
            </div>
          ) : (
            <div className="py-1">
              {log.map((entry, i) => (
                <div key={entry.hash} className="flex items-start gap-2 px-3 py-1.5 hover:bg-[var(--bg-hover)]">
                  <div className="shrink-0 mt-1 flex flex-col items-center">
                    <GitCommit size={10} className="text-[var(--color-accent)]" />
                    {i < log.length - 1 && <div className="w-px flex-1 mt-0.5 bg-[var(--border-subtle)]" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] text-[var(--fg-main)] truncate leading-tight">{entry.message}</p>
                    <p className="text-[9px] text-[var(--fg-muted)] mt-0.5">{entry.author} · {entry.date}</p>
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
}
