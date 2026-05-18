import { useState } from 'react';
import { ChevronDown, ChevronRight, Clock, Check, Loader2, X, Terminal, FileText, Search, FolderOpen, GitBranch, Globe, Edit3 } from 'lucide-react';

interface Props {
  toolName: string;
  args: string;
  result?: string;
  status?: 'running' | 'done' | 'error';
  duration?: number;
}

const TOOL_ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  read_file: FileText,
  write_file: FileText,
  file_edit: Edit3,
  list_directory: FolderOpen,
  glob_search: Search,
  grep_search: Search,
  run_terminal_command: Terminal,
  check_port_status: Globe,
  git_clone: GitBranch,
};

const TOOL_LABELS: Record<string, string> = {
  read_file: 'Read File',
  write_file: 'Write File',
  file_edit: 'Edit File',
  list_directory: 'List Directory',
  glob_search: 'Glob Search',
  grep_search: 'Grep Search',
  run_terminal_command: 'Terminal',
  check_port_status: 'Check Port',
  git_clone: 'Git Clone',
};

function formatSummary(toolName: string, argsStr: string): string {
  if (!argsStr) return '';
  try {
    const p = JSON.parse(argsStr);
    if (toolName === 'read_file' || toolName === 'write_file' || toolName === 'file_edit') return p.path || '';
    if (toolName === 'list_directory') return p.path || '';
    if (toolName === 'glob_search') return `${p.pattern}`;
    if (toolName === 'grep_search') return `"${p.query}"`;
    if (toolName === 'run_terminal_command') return p.command || '';
    return '';
  } catch { return ''; }
}

export default function ToolCallCard({ toolName, args, result, status = 'done', duration }: Props) {
  const [expanded, setExpanded] = useState(false);
  const Icon = TOOL_ICONS[toolName] || Terminal;
  const label = TOOL_LABELS[toolName] || toolName;
  const summary = formatSummary(toolName, args);

  const statusColor = status === 'running' ? 'var(--color-accent)' : status === 'error' ? 'var(--color-danger)' : 'var(--color-success)';

  return (
    <div
      className="rounded-lg overflow-hidden transition-all"
      style={{
        background: 'var(--bg-surface-alt)',
        border: '1px solid var(--border)',
      }}
    >
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors"
        style={{ color: 'var(--fg-secondary)' }}
        aria-expanded={expanded}
      >
        <div style={{ color: statusColor }}>
          {status === 'running' ? (
            <Loader2 size={14} className="animate-spin" />
          ) : status === 'error' ? (
            <X size={14} />
          ) : (
            <Check size={14} />
          )}
        </div>
        <Icon size={13} style={{ color: 'var(--fg-muted)' }} />
        <span className="text-xs font-medium flex-1 truncate" style={{ color: 'var(--fg-main)' }}>
          {label}
        </span>
        {summary && (
          <span className="text-[11px] font-mono truncate max-w-[200px]" style={{ color: 'var(--fg-muted)' }}>
            {summary}
          </span>
        )}
        {duration !== undefined && duration > 0 && (
          <span className="text-[10px] flex items-center gap-0.5" style={{ color: 'var(--fg-muted)' }}>
            <Clock size={10} />
            {duration < 1000 ? `${duration}ms` : `${(duration / 1000).toFixed(1)}s`}
          </span>
        )}
        <div style={{ color: 'var(--fg-muted)' }}>
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </div>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="animate-in" style={{ borderTop: '1px solid var(--border)' }}>
          {/* Args */}
          <div className="px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider font-semibold mb-1" style={{ color: 'var(--fg-muted)' }}>
              Arguments
            </div>
            <pre
              className="text-[11px] font-mono rounded-md p-2 overflow-auto max-h-40"
              style={{ background: 'var(--bg-hover)', color: 'var(--fg-secondary)' }}
            >
              {(() => {
                try { return JSON.stringify(JSON.parse(args), null, 2); }
                catch { return args || '(empty)'; }
              })()}
            </pre>
          </div>

          {/* Result */}
          {result && (
            <div className="px-3 py-2" style={{ borderTop: '1px solid var(--border)' }}>
              <div className="text-[10px] uppercase tracking-wider font-semibold mb-1" style={{ color: 'var(--fg-muted)' }}>
                Result
              </div>
              <pre
                className="text-[11px] font-mono rounded-md p-2 overflow-auto max-h-48"
                style={{ background: 'var(--bg-hover)', color: 'var(--fg-secondary)' }}
              >
                {result.length > 3000 ? result.slice(0, 3000) + '\n... (truncated)' : result}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
