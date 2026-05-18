import { Shield, CheckCircle2, Clock, ListChecks } from 'lucide-react';
import type { Project } from '../../lib/types';

interface PendingApproval {
  approvalId: string;
  tool: string;
  args: string;
}

interface Props {
  safeMode: boolean;
  onToggleSafeMode: () => void;
  pendingApprovals: PendingApproval[];
  onApprove: (id: string, decision: 'approve' | 'reject') => void;
  taskPlan: string[];
  activeProject: Project | null;
}

export default function OpsPanel({ safeMode, onToggleSafeMode, pendingApprovals, onApprove, taskPlan, activeProject }: Props) {
  return (
    <div className="h-full flex flex-col overflow-hidden" style={{ background: 'var(--bg-surface)' }}>
      {/* Header */}
      <div
        className="h-9 flex items-center justify-between px-3 shrink-0"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <span className="text-[11px] font-medium" style={{ color: 'var(--fg-secondary)' }}>Operations</span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto premium-scroll p-3 space-y-4">
        {/* Safe Mode */}
        <div
          className="rounded-lg p-3"
          style={{ background: 'var(--bg-surface-alt)', border: '1px solid var(--border)' }}
        >
          <button
            onClick={onToggleSafeMode}
            className="w-full flex items-center justify-between"
            role="switch"
            aria-checked={safeMode}
          >
            <div className="flex items-center gap-2">
              <Shield size={14} style={{ color: safeMode ? 'var(--color-warning)' : 'var(--fg-muted)' }} />
              <span className="text-xs font-medium" style={{ color: 'var(--fg-main)' }}>Safe Mode</span>
            </div>
            <div
              className="w-8 h-4 rounded-full relative transition-colors"
              style={{ background: safeMode ? 'var(--color-warning)' : 'var(--fg-faint)' }}
            >
              <div
                className="absolute top-0.5 w-3 h-3 rounded-full transition-all"
                style={{ background: 'white', left: safeMode ? '16px' : '2px' }}
              />
            </div>
          </button>
          <p className="text-[10px] mt-1.5" style={{ color: 'var(--fg-muted)' }}>
            Requires approval for sensitive operations.
          </p>
        </div>

        {/* Task Plan */}
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <ListChecks size={13} style={{ color: 'var(--fg-muted)' }} />
            <span className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--fg-muted)' }}>
              Task Plan
            </span>
          </div>
          {taskPlan.length > 0 ? (
            <ul className="space-y-1">
              {taskPlan.map((item, idx) => (
                <li
                  key={idx}
                  className="flex items-start gap-2 px-2.5 py-1.5 rounded-md text-xs"
                  style={{ background: 'var(--bg-hover)', color: 'var(--fg-secondary)' }}
                >
                  <CheckCircle2 size={12} className="shrink-0 mt-0.5" style={{ color: 'var(--color-success)' }} />
                  {item}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs" style={{ color: 'var(--fg-muted)' }}>No plan yet</p>
          )}
        </div>

        {/* Pending Approvals */}
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <Clock size={13} style={{ color: 'var(--fg-muted)' }} />
            <span className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--fg-muted)' }}>
              Pending Approvals
            </span>
            {pendingApprovals.length > 0 && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded-full"
                style={{ background: 'rgba(245, 158, 11, 0.1)', color: 'var(--color-warning)' }}
              >
                {pendingApprovals.length}
              </span>
            )}
          </div>
          {pendingApprovals.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--fg-muted)' }}>None pending</p>
          ) : (
            <div className="space-y-2">
              {pendingApprovals.map((item) => (
                <div
                  key={item.approvalId}
                  className="rounded-lg p-3"
                  style={{
                    background: 'rgba(245, 158, 11, 0.05)',
                    border: '1px solid rgba(245, 158, 11, 0.15)',
                  }}
                >
                  <div className="text-xs font-medium mb-1.5" style={{ color: 'var(--fg-main)' }}>
                    {item.tool}
                  </div>
                  <pre
                    className="text-[10px] font-mono rounded p-2 mb-2 overflow-auto max-h-24"
                    style={{ background: 'var(--bg-hover)', color: 'var(--fg-muted)' }}
                  >
                    {(() => { try { return JSON.stringify(JSON.parse(item.args), null, 2); } catch { return item.args; } })()}
                  </pre>
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => onApprove(item.approvalId, 'reject')}
                      className="flex-1 px-2 py-1.5 text-[11px] rounded-md font-medium transition-colors"
                      style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#f87171' }}
                    >
                      Reject
                    </button>
                    <button
                      onClick={() => onApprove(item.approvalId, 'approve')}
                      className="flex-1 px-2 py-1.5 text-[11px] rounded-md font-medium transition-colors"
                      style={{ background: 'rgba(34, 197, 94, 0.1)', color: '#4ade80' }}
                    >
                      Approve
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Project Info */}
        {activeProject && (
          <div>
            <span className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--fg-muted)' }}>
              Project
            </span>
            <div
              className="mt-1.5 rounded-lg p-2.5 text-xs"
              style={{ background: 'var(--bg-hover)', color: 'var(--fg-secondary)' }}
            >
              <div className="font-medium" style={{ color: 'var(--fg-main)' }}>{activeProject.name}</div>
              <div className="text-[10px] mt-0.5 truncate">{activeProject.path}</div>
              {activeProject.lastPort && (
                <div className="text-[10px] mt-0.5">Port: {activeProject.lastPort}</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
