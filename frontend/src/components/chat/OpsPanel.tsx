import { Shield, CheckCircle2, Clock, ListChecks, Globe, Terminal as TerminalIcon, BrainCircuit } from 'lucide-react';
import type { ApprovalRequest, ExecutionArtifact, PlannerArtifact, Project, RuntimeArtifact } from '../../lib/types';

interface Props {
  safeMode: boolean;
  onToggleSafeMode: () => void;
  pendingApprovals: ApprovalRequest[];
  onApprove: (id: string, decision: 'approve' | 'reject') => void;
  taskPlan: string[];
  plannerArtifact: PlannerArtifact | null;
  executionArtifacts: ExecutionArtifact[];
  projectMemory?: Record<string, unknown>;
  activeProject: Project | null;
}

export default function OpsPanel({ safeMode, onToggleSafeMode, pendingApprovals, onApprove, taskPlan, plannerArtifact, executionArtifacts, projectMemory, activeProject }: Props) {
  const lastBrowserArtifact = (projectMemory?.lastBrowserArtifact || null) as RuntimeArtifact | null;
  const lastGuiArtifact = (projectMemory?.lastGuiArtifact || null) as RuntimeArtifact | null;
  const lastTerminalArtifact = (projectMemory?.lastTerminalArtifact || null) as RuntimeArtifact | null;
  const lastValidation = (projectMemory?.lastValidation || null) as { status?: string; summary?: string } | null;
  const lastApprovalDecision = (projectMemory?.lastApprovalDecision || null) as { decision?: string; title?: string; riskLevel?: string } | null;
  const evidenceSummary = (projectMemory?.evidenceSummary || null) as {
    headline?: string;
    items?: Array<{ label: string; status: string; summary: string }>;
  } | null;
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

        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <Clock size={13} style={{ color: 'var(--fg-muted)' }} />
            <span className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--fg-muted)' }}>
              Execution Trace
            </span>
          </div>
          {executionArtifacts.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--fg-muted)' }}>Execution trace hələ yoxdur</p>
          ) : (
            <div className="space-y-2">
              {executionArtifacts.slice(-6).map((artifact, idx) => (
                <div key={`${artifact.role}-${artifact.timestamp}-${idx}`} className="rounded-lg p-3" style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)' }}>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="text-[11px] font-semibold" style={{ color: 'var(--fg-main)' }}>{artifact.role}</div>
                    <div className="text-[10px]" style={{ color: 'var(--fg-muted)' }}>
                      {new Date(artifact.timestamp).toLocaleTimeString()}
                    </div>
                  </div>
                  <div className="text-xs mb-2" style={{ color: 'var(--fg-secondary)' }}>
                    {artifact.summary || 'Yekun yoxdur'}
                  </div>
                  {artifact.toolNames?.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {artifact.toolNames.map((tool, toolIdx) => (
                        <span
                          key={`${tool}-${toolIdx}`}
                          className="px-2 py-1 rounded-md text-[10px] font-mono"
                          style={{ background: 'var(--bg-surface)', color: 'var(--fg-secondary)', border: '1px solid var(--border)' }}
                        >
                          {tool}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {(lastBrowserArtifact || lastGuiArtifact || lastTerminalArtifact) && (
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <Globe size={13} style={{ color: 'var(--fg-muted)' }} />
              <span className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--fg-muted)' }}>
                Runtime Memory
              </span>
            </div>
            <div className="space-y-2">
              {lastBrowserArtifact && (
                <div className="rounded-lg p-3" style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)' }}>
                  <div className="flex items-center gap-2 mb-1">
                    <Globe size={12} style={{ color: 'var(--fg-muted)' }} />
                    <div className="text-[11px] font-semibold" style={{ color: 'var(--fg-main)' }}>
                      {lastBrowserArtifact.toolName || 'browser'}
                    </div>
                  </div>
                  <div className="text-xs" style={{ color: 'var(--fg-secondary)' }}>
                    {lastBrowserArtifact.summary || 'No browser summary'}
                  </div>
                  {lastBrowserArtifact.screenshotPath && (
                    <div className="text-[10px] mt-1 font-mono truncate" style={{ color: 'var(--fg-muted)' }}>
                      {lastBrowserArtifact.screenshotPath}
                    </div>
                  )}
                </div>
              )}
              {lastGuiArtifact && (
                <div className="rounded-lg p-3" style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)' }}>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <BrainCircuit size={12} style={{ color: 'var(--fg-muted)' }} />
                      <div className="text-[11px] font-semibold truncate" style={{ color: 'var(--fg-main)' }}>
                        {lastGuiArtifact.toolName || 'gui'}
                      </div>
                    </div>
                    {lastGuiArtifact.status && (
                      <span className="text-[10px]" style={{ color: lastGuiArtifact.status === 'failed' ? 'var(--color-warning)' : 'var(--fg-muted)' }}>
                        {lastGuiArtifact.status}
                      </span>
                    )}
                  </div>
                  <div className="text-xs" style={{ color: 'var(--fg-secondary)' }}>
                    {lastGuiArtifact.summary || lastGuiArtifact.assessment?.reason || 'No GUI summary'}
                  </div>
                  {lastGuiArtifact.action && (
                    <div className="text-[10px] mt-1 font-mono truncate" style={{ color: 'var(--fg-muted)' }}>
                      {String(lastGuiArtifact.action.type || '')} {String(lastGuiArtifact.action.selector || lastGuiArtifact.action.key || '')}
                    </div>
                  )}
                  {lastGuiArtifact.screenshotPath && (
                    <div className="text-[10px] mt-1 font-mono truncate" style={{ color: 'var(--fg-muted)' }}>
                      {lastGuiArtifact.screenshotPath}
                    </div>
                  )}
                </div>
              )}
              {lastTerminalArtifact && (
                <div className="rounded-lg p-3" style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)' }}>
                  <div className="flex items-center gap-2 mb-1">
                    <TerminalIcon size={12} style={{ color: 'var(--fg-muted)' }} />
                    <div className="text-[11px] font-semibold" style={{ color: 'var(--fg-main)' }}>
                      {lastTerminalArtifact.command || lastTerminalArtifact.toolName || 'terminal'}
                    </div>
                  </div>
                  <div className="text-xs" style={{ color: 'var(--fg-secondary)' }}>
                    {lastTerminalArtifact.output?.slice(0, 180) || lastTerminalArtifact.summary || 'No terminal output'}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {(lastValidation || lastApprovalDecision) && (
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <CheckCircle2 size={13} style={{ color: 'var(--fg-muted)' }} />
              <span className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--fg-muted)' }}>
                Recent State
              </span>
            </div>
            <div className="space-y-2">
              {lastValidation && (
                <div className="rounded-lg p-3" style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)' }}>
                  <div className="text-[11px] font-semibold mb-1" style={{ color: 'var(--fg-main)' }}>
                    Validation: {lastValidation.status || 'unknown'}
                  </div>
                  <div className="text-xs" style={{ color: 'var(--fg-secondary)' }}>
                    {String(lastValidation.summary || '').slice(0, 180) || 'No validation summary'}
                  </div>
                </div>
              )}
              {lastApprovalDecision && (
                <div className="rounded-lg p-3" style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)' }}>
                  <div className="text-[11px] font-semibold mb-1" style={{ color: 'var(--fg-main)' }}>
                    Approval: {lastApprovalDecision.decision || 'unknown'}
                  </div>
                  <div className="text-xs" style={{ color: 'var(--fg-secondary)' }}>
                    {lastApprovalDecision.title || 'No approval title'}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {evidenceSummary?.items?.length ? (
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <CheckCircle2 size={13} style={{ color: 'var(--fg-muted)' }} />
              <span className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--fg-muted)' }}>
                Evidence Summary
              </span>
            </div>
            <div className="rounded-lg p-3 space-y-2" style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)' }}>
              <div className="text-[11px] font-semibold" style={{ color: 'var(--fg-main)' }}>
                {evidenceSummary.headline || 'Evidence summary'}
              </div>
              {evidenceSummary.items.map((item, idx) => (
                <div key={`${item.label}-${idx}`} className="rounded-md p-2" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="text-[11px] font-medium" style={{ color: 'var(--fg-main)' }}>
                      {item.label}
                    </div>
                    <div
                      className="text-[10px]"
                      style={{
                        color: item.status === 'failed'
                          ? 'var(--color-warning)'
                          : item.status === 'missing'
                            ? 'var(--fg-muted)'
                            : 'var(--color-success)'
                      }}
                    >
                      {item.status}
                    </div>
                  </div>
                  <div className="text-xs" style={{ color: 'var(--fg-secondary)' }}>
                    {String(item.summary || '').slice(0, 160)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

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

        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <ListChecks size={13} style={{ color: 'var(--fg-muted)' }} />
            <span className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--fg-muted)' }}>
              Workflow Context
            </span>
          </div>
          {!plannerArtifact ? (
            <p className="text-xs" style={{ color: 'var(--fg-muted)' }}>Planner artifact hələ yoxdur</p>
          ) : (
            <div className="space-y-2">
              <div className="rounded-lg p-3" style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)' }}>
                <div className="text-[11px] font-semibold mb-1" style={{ color: 'var(--fg-main)' }}>Goal</div>
                <div className="text-xs" style={{ color: 'var(--fg-secondary)' }}>{plannerArtifact.goal || plannerArtifact.summary || 'Yoxdur'}</div>
              </div>

              {plannerArtifact.filesToInspect?.length > 0 && (
                <div className="rounded-lg p-3" style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)' }}>
                  <div className="text-[11px] font-semibold mb-1.5" style={{ color: 'var(--fg-main)' }}>Files</div>
                  <div className="flex flex-wrap gap-1.5">
                    {plannerArtifact.filesToInspect.slice(0, 8).map((item, idx) => (
                      <span
                        key={`${item}-${idx}`}
                        className="px-2 py-1 rounded-md text-[10px] font-mono"
                        style={{ background: 'var(--bg-surface)', color: 'var(--fg-secondary)', border: '1px solid var(--border)' }}
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {plannerArtifact.suspectedRisks?.length > 0 && (
                <div className="rounded-lg p-3" style={{ background: 'rgba(245, 158, 11, 0.05)', border: '1px solid rgba(245, 158, 11, 0.15)' }}>
                  <div className="text-[11px] font-semibold mb-1.5" style={{ color: 'var(--fg-main)' }}>Risks</div>
                  <ul className="space-y-1">
                    {plannerArtifact.suspectedRisks.slice(0, 6).map((item, idx) => (
                      <li key={`${item}-${idx}`} className="text-xs" style={{ color: 'var(--fg-secondary)' }}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}

              {plannerArtifact.implementationSteps?.length > 0 && (
                <div className="rounded-lg p-3" style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)' }}>
                  <div className="text-[11px] font-semibold mb-1.5" style={{ color: 'var(--fg-main)' }}>Implementation</div>
                  <ol className="space-y-1">
                    {plannerArtifact.implementationSteps.slice(0, 6).map((item, idx) => (
                      <li key={`${item}-${idx}`} className="text-xs" style={{ color: 'var(--fg-secondary)' }}>
                        {idx + 1}. {item}
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {plannerArtifact.verificationSteps?.length > 0 && (
                <div className="rounded-lg p-3" style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)' }}>
                  <div className="text-[11px] font-semibold mb-1.5" style={{ color: 'var(--fg-main)' }}>Verification</div>
                  <ul className="space-y-1">
                    {plannerArtifact.verificationSteps.slice(0, 6).map((item, idx) => (
                      <li key={`${item}-${idx}`} className="text-xs" style={{ color: 'var(--fg-secondary)' }}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}

              {plannerArtifact.workUnits?.length > 0 && (
                <div className="rounded-lg p-3" style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)' }}>
                  <div className="text-[11px] font-semibold mb-1.5" style={{ color: 'var(--fg-main)' }}>Work Units</div>
                  <div className="space-y-2">
                    {plannerArtifact.workUnits.slice(0, 8).map((item, idx) => (
                      <div key={`${item.label}-${idx}`} className="rounded-md p-2" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
                        <div className="text-xs mb-1" style={{ color: 'var(--fg-secondary)' }}>{item.label}</div>
                        <div className="flex flex-wrap gap-1.5">
                          <span className="px-2 py-1 rounded-md text-[10px]" style={{ background: item.parallel ? 'rgba(34, 197, 94, 0.12)' : 'rgba(148, 163, 184, 0.12)', color: 'var(--fg-main)' }}>
                            {item.parallel ? 'parallel' : 'sequential'}
                          </span>
                          {item.role && (
                            <span className="px-2 py-1 rounded-md text-[10px]" style={{ background: 'var(--bg-hover)', color: 'var(--fg-secondary)', border: '1px solid var(--border)' }}>
                              role: {item.role}
                            </span>
                          )}
                          {item.blockedBy && (
                            <span className="px-2 py-1 rounded-md text-[10px]" style={{ background: 'rgba(245, 158, 11, 0.12)', color: 'var(--fg-main)' }}>
                              after: {item.blockedBy}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
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
                    {item.meta?.title || item.tool}
                  </div>
                  {item.meta?.summary && (
                    <div className="text-[10px] mb-2 truncate" style={{ color: 'var(--fg-secondary)' }}>
                      {item.meta.summary}
                    </div>
                  )}
                  {item.meta?.diffStats && (
                    <div className="text-[10px] font-mono mb-2" style={{ color: 'var(--fg-muted)' }}>
                      +{item.meta.diffStats.added} -{item.meta.diffStats.removed}
                    </div>
                  )}
                  {item.meta?.diffPreview ? (
                    <pre
                      className="text-[10px] font-mono rounded p-2 mb-2 overflow-auto max-h-24"
                      style={{ background: 'var(--bg-hover)', color: 'var(--fg-muted)' }}
                    >
                      {item.meta.diffPreview}
                    </pre>
                  ) : (
                    <pre
                      className="text-[10px] font-mono rounded p-2 mb-2 overflow-auto max-h-24"
                      style={{ background: 'var(--bg-hover)', color: 'var(--fg-muted)' }}
                    >
                      {item.meta?.preview || (() => { try { return JSON.stringify(JSON.parse(item.args), null, 2); } catch { return item.args; } })()}
                    </pre>
                  )}
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
