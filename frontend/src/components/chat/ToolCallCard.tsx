import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Clock, Check, Loader2, X, Terminal, FileText, Search, FolderOpen, GitBranch, Globe, Edit3, MousePointerClick, Keyboard, Camera, ExternalLink, Timer, Braces, ArrowDownToLine, MoveVertical, ScanSearch, MonitorCog, BrainCircuit } from 'lucide-react';
import { API_BASE_URL } from '../../lib/constants';

interface Props {
  toolName: string;
  args: string;
  result?: string;
  status?: 'running' | 'done' | 'error';
  duration?: number;
  workingDirectory?: string;
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
  browser_open: Globe,
  browser_click: MousePointerClick,
  browser_type: Keyboard,
  browser_screenshot: Camera,
  browser_wait_for: Timer,
  browser_eval: Braces,
  browser_press: ArrowDownToLine,
  browser_scroll: MoveVertical,
  browser_extract: ScanSearch,
  gui_observe: MonitorCog,
  gui_act: MousePointerClick,
  gui_step: BrainCircuit,
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
  browser_open: 'Browser Open',
  browser_click: 'Browser Click',
  browser_type: 'Browser Type',
  browser_screenshot: 'Browser Screenshot',
  browser_wait_for: 'Browser Wait',
  browser_eval: 'Browser Eval',
  browser_press: 'Browser Press',
  browser_scroll: 'Browser Scroll',
  browser_extract: 'Browser Extract',
  gui_observe: 'GUI Observe',
  gui_act: 'GUI Action',
  gui_step: 'GUI Step',
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
    if (toolName === 'browser_open') return p.url || '';
    if (toolName === 'browser_click' || toolName === 'browser_type') return p.selector || '';
    if (toolName === 'browser_screenshot') return p.sessionId || 'default';
    if (toolName === 'browser_wait_for') return p.selector || p.state || 'page';
    if (toolName === 'browser_eval') return p.expression || '';
    if (toolName === 'browser_press') return p.selector ? `${p.selector} -> ${p.key || ''}` : (p.key || '');
    if (toolName === 'browser_scroll') return p.selector || p.to || `${p.x || 0}, ${p.y || 0}`;
    if (toolName === 'browser_extract') return p.selector || '';
    if (toolName === 'gui_observe') return p.goal || p.sessionId || 'observe';
    if (toolName === 'gui_act') return p.action?.type ? `${p.action.type} ${p.action.selector || p.action.key || ''}` : 'action';
    if (toolName === 'gui_step') return p.goal || p.action?.type || 'step';
    return '';
  } catch { return ''; }
}

function extractScreenshotPath(result?: string): string | null {
  if (!result) return null;
  const match = String(result).match(/Screenshot saved:\s*(.+)$/i);
  return match?.[1]?.trim() || null;
}

function parseJsonResult(result?: string): any | null {
  if (!result) return null;
  try {
    return JSON.parse(result);
  } catch {
    return null;
  }
}

function extractGuiScreenshotPath(parsed: any): string | null {
  return parsed?.observation?.screenshotPath || parsed?.inspection?.observation?.screenshotPath || null;
}

function formatAction(action: any): string {
  if (!action) return 'No action';
  const parts = [
    action.type,
    action.selector,
    action.key,
    action.text ? `"${String(action.text).slice(0, 40)}"` : '',
  ].filter(Boolean);
  return parts.join(' ');
}

export default function ToolCallCard({ toolName, args, result, status = 'done', duration, workingDirectory }: Props) {
  const [expanded, setExpanded] = useState(false);
  const Icon = TOOL_ICONS[toolName] || Terminal;
  const label = TOOL_LABELS[toolName] || toolName;
  const summary = formatSummary(toolName, args);
  const parsedResult = useMemo(() => parseJsonResult(result), [result]);
  const guiResult = toolName.startsWith('gui_') ? parsedResult : null;
  const screenshotPath = useMemo(() => extractScreenshotPath(result) || extractGuiScreenshotPath(guiResult), [result, guiResult]);
  const screenshotUrl = useMemo(() => {
    if (!screenshotPath || !workingDirectory) return null;
    const qs = new URLSearchParams({
      path: screenshotPath,
      workingDirectory
    });
    return `${API_BASE_URL}/api/browser-shot?${qs.toString()}`;
  }, [screenshotPath, workingDirectory]);

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
        className="w-full px-3 py-2 text-left transition-colors"
        style={{ color: 'var(--fg-secondary)' }}
        aria-expanded={expanded}
      >
        <div className="flex items-start gap-2">
          <div className="pt-0.5 shrink-0" style={{ color: statusColor }}>
            {status === 'running' ? (
              <Loader2 size={14} className="animate-spin" />
            ) : status === 'error' ? (
              <X size={14} />
            ) : (
              <Check size={14} />
            )}
          </div>
          <Icon size={13} className="mt-0.5 shrink-0" style={{ color: 'var(--fg-muted)' }} />
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-2">
              <span className="text-xs font-medium flex-1 truncate" style={{ color: 'var(--fg-main)' }}>
                {label}
              </span>
              <div className="shrink-0 pt-0.5" style={{ color: 'var(--fg-muted)' }}>
                {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              </div>
            </div>
            <div className="mt-1 flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
              {summary && (
                <span className="text-[11px] font-mono break-all sm:truncate sm:max-w-[240px]" style={{ color: 'var(--fg-muted)' }}>
                  {summary}
                </span>
              )}
              {duration !== undefined && duration > 0 && (
                <span className="text-[10px] inline-flex items-center gap-0.5" style={{ color: 'var(--fg-muted)' }}>
                  <Clock size={10} />
                  {duration < 1000 ? `${duration}ms` : `${(duration / 1000).toFixed(1)}s`}
                </span>
              )}
            </div>
          </div>
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
              className="text-[10px] sm:text-[11px] font-mono rounded-md p-2 overflow-auto max-h-40 whitespace-pre-wrap break-words"
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
              {guiResult && (
                <div
                  className="mb-3 rounded-md p-2.5 space-y-2"
                  style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)' }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <BrainCircuit size={13} style={{ color: 'var(--fg-muted)' }} />
                      <span className="text-[11px] font-semibold truncate" style={{ color: 'var(--fg-main)' }}>
                        GUI Decision
                      </span>
                    </div>
                    {guiResult.assessment && (
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded"
                        style={{
                          color: guiResult.assessment.executable ? 'var(--color-success)' : 'var(--color-warning)',
                          background: 'var(--bg-surface)',
                          border: '1px solid var(--border)'
                        }}
                      >
                        {guiResult.assessment.executable ? 'Executable' : 'Held'}
                      </span>
                    )}
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2">
                    <div>
                      <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--fg-muted)' }}>
                        Action
                      </div>
                      <div className="text-[10px] sm:text-[11px] font-mono break-words" style={{ color: 'var(--fg-secondary)' }}>
                        {formatAction(guiResult.action)}
                      </div>
                      {guiResult.action?.confidence !== undefined && (
                        <div className="text-[10px] mt-1" style={{ color: 'var(--fg-muted)' }}>
                          Confidence: {Number(guiResult.action.confidence).toFixed(2)}
                        </div>
                      )}
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--fg-muted)' }}>
                        Reason
                      </div>
                      <div className="text-[10px] sm:text-[11px] break-words" style={{ color: 'var(--fg-secondary)' }}>
                        {guiResult.assessment?.reason || guiResult.reflection?.nextRecommendation || 'No reason returned'}
                      </div>
                    </div>
                  </div>

                  {(guiResult.observation?.title || guiResult.observation?.url) && (
                    <div className="pt-2" style={{ borderTop: '1px solid var(--border)' }}>
                      <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--fg-muted)' }}>
                        Observation
                      </div>
                      <div className="text-[11px] break-words sm:truncate" style={{ color: 'var(--fg-secondary)' }}>
                        {guiResult.observation?.title || 'Untitled'}
                      </div>
                      {guiResult.observation?.url && (
                        <div className="text-[10px] break-all sm:truncate font-mono mt-0.5" style={{ color: 'var(--fg-muted)' }}>
                          {guiResult.observation.url}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
              {screenshotUrl && (
                <div className="mb-3">
                  <a
                    href={screenshotUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="group block overflow-hidden rounded-md"
                    style={{ border: '1px solid var(--border)', background: 'var(--bg-hover)' }}
                  >
                    <img
                      src={screenshotUrl}
                      alt="Browser screenshot"
                      className="block w-full h-auto max-h-64 object-cover"
                    />
                    <div className="flex items-center justify-between px-2.5 py-2 text-[11px]" style={{ color: 'var(--fg-secondary)' }}>
                      <span className="truncate">Browser screenshot</span>
                      <span className="inline-flex items-center gap-1" style={{ color: 'var(--fg-muted)' }}>
                        Open
                        <ExternalLink size={12} />
                      </span>
                    </div>
                  </a>
                </div>
              )}
              <pre
                className="text-[10px] sm:text-[11px] font-mono rounded-md p-2 overflow-auto max-h-48 whitespace-pre-wrap break-words"
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
