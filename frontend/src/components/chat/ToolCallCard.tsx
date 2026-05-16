// ==========================================
// ToolCallCard — Displays tool execution with details
// ==========================================

import { useState } from 'react';
import { ChevronDown, ChevronRight, Clock, CheckCircle2, Loader2 } from 'lucide-react';
import { TOOL_ICONS, TOOL_LABELS } from '../../lib/constants';

interface ToolCallCardProps {
  toolName: string;
  args: string;
  result?: string;
  status?: 'running' | 'done' | 'error';
  duration?: number;
}

function formatArgs(toolName: string, argsStr: string): string {
  if (!argsStr) return '';
  try {
    const p = JSON.parse(argsStr);
    if (toolName === 'read_file' || toolName === 'write_file' || toolName === 'file_edit') return p.path || p.filepath || '';
    if (toolName === 'list_directory') return p.path || '';
    if (toolName === 'glob_search') return `${p.pattern} in ${p.cwd || '.'}`;
    if (toolName === 'grep_search') return `"${p.query}" in ${p.cwd || '.'}`;
    if (toolName === 'run_terminal_command' || toolName === 'run_bash') return p.command || '';
    return argsStr;
  } catch { return argsStr; }
}

function tryParseJSON(str: string): any { try { return JSON.parse(str); } catch { return null; } }

export default function ToolCallCard({ toolName, args, result, status = 'done', duration }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);
  const Icon = TOOL_ICONS[toolName];
  const label = TOOL_LABELS[toolName] || toolName;
  const summary = formatArgs(toolName, args);

  return (
    <div className="my-2 rounded-lg border overflow-hidden transition-all duration-200"
      style={{ borderColor: 'var(--border-subtle)', background: 'var(--surface-raised)' }}>
      <button onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors hover:opacity-80">
        <div style={{ color: 'var(--fg-muted)' }}>{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</div>
        <div className="flex-shrink-0" style={{ color: 'var(--color-accent)' }}>
          {Icon ? <Icon size={16} /> : <span className="text-base">🔧</span>}
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--fg-3)' }}>{label}</span>
          {summary && <span className="ml-2 text-xs font-mono truncate" style={{ color: 'var(--fg-muted)' }}>{summary.length > 60 ? summary.slice(0, 60) + '...' : summary}</span>}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {duration !== undefined && <span className="text-[11px] flex items-center gap-1" style={{ color: 'var(--fg-faint)' }}><Clock size={10} />{(duration / 1000).toFixed(1)}s</span>}
          {status === 'running' && <Loader2 size={14} className="text-blue-400 animate-spin" />}
          {status === 'done' && <CheckCircle2 size={14} className="text-green-500/70" />}
          {status === 'error' && <span className="text-red-400 text-xs">✕</span>}
        </div>
      </button>

      {expanded && (
        <div style={{ borderTop: '1px solid var(--border-subtle)' }}>
          <div className="px-4 py-3">
            <div className="text-[10px] uppercase tracking-wider font-semibold mb-1.5" style={{ color: 'var(--fg-faint)' }}>Arqumentlər</div>
            <pre className="text-xs font-mono rounded-md p-3 overflow-x-auto max-h-40 border"
              style={{ color: 'var(--fg-3)', background: 'var(--surface)', borderColor: 'var(--border-subtle)' }}>
              {(() => { const p = tryParseJSON(args); return p ? JSON.stringify(p, null, 2) : args; })()}
            </pre>
          </div>
          {result && (
            <div className="px-4 py-3" style={{ borderTop: '1px solid var(--border-subtle)' }}>
              <div className="text-[10px] uppercase tracking-wider font-semibold mb-1.5" style={{ color: 'var(--fg-faint)' }}>Nəticə</div>
              <pre className="text-xs font-mono rounded-md p-3 overflow-x-auto max-h-60 border"
                style={{ color: 'var(--fg-3)', background: 'var(--surface)', borderColor: 'var(--border-subtle)' }}>
                {result.length > 2000 ? result.slice(0, 2000) + '\n... (kəsildi)' : result}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
