import type { ActionCenterInteraction } from '../../lib/types';

interface Props {
  interactions: ActionCenterInteraction[];
  history?: ActionCenterInteraction[];
  onResolveCheckpoint: (decision: 'resume' | 'cancel') => void;
  onApprove: (id: string, decision: 'approve' | 'reject') => void;
}

function getRiskPalette(level?: 'low' | 'medium' | 'high') {
  if (level === 'high') {
    return {
      bg: 'rgba(239, 68, 68, 0.08)',
      border: '1px solid rgba(239, 68, 68, 0.2)',
      text: '#fca5a5',
      pill: 'rgba(239, 68, 68, 0.14)'
    };
  }
  if (level === 'low') {
    return {
      bg: 'rgba(34, 197, 94, 0.08)',
      border: '1px solid rgba(34, 197, 94, 0.2)',
      text: '#86efac',
      pill: 'rgba(34, 197, 94, 0.14)'
    };
  }
  return {
    bg: 'rgba(245, 158, 11, 0.08)',
    border: '1px solid rgba(245, 158, 11, 0.2)',
    text: '#fbbf24',
    pill: 'rgba(245, 158, 11, 0.14)'
  };
}

function renderDiffPreview(diffPreview: string) {
  return diffPreview.split('\n').map((line, index) => {
    const isAdded = line.startsWith('+');
    const isRemoved = line.startsWith('-');
    const isHeader = line.startsWith('# ');
    return (
      <div
        key={`${index}-${line.slice(0, 16)}`}
        className="font-mono whitespace-pre-wrap break-words"
        style={{
          color: isHeader ? 'var(--fg-secondary)' : isAdded ? '#86efac' : isRemoved ? '#fca5a5' : 'var(--fg-muted)'
        }}
      >
        {line}
      </div>
    );
  });
}

function formatMetaLine({ runId, phaseRole, conversationId, expiresAt }: { runId?: string; phaseRole?: string; conversationId?: string; expiresAt?: number }) {
  const parts = [];
  if (phaseRole) parts.push(`Faza: ${phaseRole}`);
  if (runId) parts.push(`Run: ${String(runId).slice(0, 8)}`);
  if (conversationId) parts.push(`Söhbət: ${String(conversationId).slice(0, 8)}`);
  if (expiresAt) parts.push(`Bitir: ${new Date(expiresAt).toLocaleTimeString()}`);
  return parts.join(' • ');
}

export default function ActionCenterModal({ interactions, history = [], onResolveCheckpoint, onApprove }: Props) {
  if (interactions.length === 0) return null;

  const grouped = interactions.reduce<Record<string, ActionCenterInteraction[]>>((acc, item) => {
    const runKey = item.checkpoint?.runId || item.approval?.runId || 'no-run';
    if (!acc[runKey]) acc[runKey] = [];
    acc[runKey].push(item);
    return acc;
  }, {});

  const checkpoint = interactions.find((item) => item.kind === 'checkpoint')?.checkpoint || null;
  const approvals = interactions
    .filter((item) => item.kind === 'approval' && item.approval)
    .map((item) => item.approval!);

  const hasExpiringSoon = interactions.some((item) => {
    const expiresAt = item.checkpoint?.expiresAt || item.approval?.expiresAt;
    return expiresAt ? expiresAt - Date.now() < 60000 : false;
  });

  const isMobile = typeof window !== 'undefined' && window.innerWidth <= 768;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-3 sm:px-4" style={{ background: 'rgba(0,0,0,0.45)' }}>
      <div
        className="w-full max-w-2xl rounded-lg p-4 sm:p-5 max-h-[85vh] overflow-y-auto premium-scroll"
        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)' }}
      >
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="text-sm font-semibold" style={{ color: 'var(--fg-main)' }}>
            Action Center
          </div>
          {hasExpiringSoon && (
            <div
              className="text-[10px] uppercase px-2 py-1 rounded-md"
              style={{ color: '#fbbf24', background: 'rgba(245, 158, 11, 0.12)', border: '1px solid rgba(245, 158, 11, 0.2)' }}
            >
              Expiring soon
            </div>
          )}
        </div>

        {!isMobile && (
        <div className="space-y-2 mb-5">
          {Object.entries(grouped).map(([runKey, items]) => (
            <div key={runKey} className="rounded-lg px-3 py-2" style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)' }}>
              <div className="text-[11px] font-semibold" style={{ color: 'var(--fg-main)' }}>
                Run {runKey === 'no-run' ? 'N/A' : runKey.slice(0, 8)}
              </div>
              <div className="text-[11px]" style={{ color: 'var(--fg-muted)' }}>
                {items.length} interaction • {items.map((item) => item.checkpoint?.phaseRole || item.approval?.phaseRole).filter(Boolean).join(', ')}
              </div>
            </div>
          ))}
        </div>
        )}

        {checkpoint && (
          <div className={approvals.length > 0 ? 'mb-5 pb-5' : ''} style={approvals.length > 0 ? { borderBottom: '1px solid var(--border)' } : undefined}>
            <div className="text-sm font-semibold mb-2" style={{ color: 'var(--fg-main)' }}>
              {checkpoint.title}
            </div>
            <div className="text-sm mb-4" style={{ color: 'var(--fg-secondary)' }}>
              {checkpoint.message}
            </div>
            <div className="text-[11px] mb-4" style={{ color: 'var(--fg-muted)' }}>
              {formatMetaLine(checkpoint)}
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <button
                onClick={() => onResolveCheckpoint('cancel')}
                className="flex-1 px-4 py-3 rounded-lg text-sm font-medium"
                style={{ color: 'var(--fg-secondary)', background: 'var(--bg-hover)', border: '1px solid var(--border)', minHeight: '44px' }}
              >
                {checkpoint.cancelLabel || 'Hələ yox'}
              </button>
              <button
                onClick={() => onResolveCheckpoint('resume')}
                className="flex-1 px-4 py-3 rounded-lg text-sm font-medium"
                style={{ color: 'white', background: 'var(--color-accent)', border: '1px solid var(--color-accent)', minHeight: '44px' }}
              >
                {checkpoint.resumeLabel || 'Davam et'}
              </button>
            </div>
          </div>
        )}

        {approvals.length > 0 && (
          <div className="space-y-3">
            <div className="text-sm font-semibold" style={{ color: 'var(--fg-main)' }}>
              Təsdiq gözləyən əməliyyatlar
            </div>
            {approvals.map((approval) => {
              const palette = getRiskPalette(approval.meta?.riskLevel);
              return (
                <div
                  key={approval.approvalId}
                  className="rounded-xl p-4"
                  style={{
                    background: palette.bg,
                    border: palette.border,
                  }}
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="text-xs font-semibold" style={{ color: palette.text }}>
                      Təsdiq tələb olunur
                    </span>
                    <span
                      className="text-[10px] uppercase px-2 py-1 rounded-md"
                      style={{ color: palette.text, background: palette.pill }}
                    >
                      {approval.meta?.riskLevel || 'medium'} risk
                    </span>
                  </div>
                  <div className="text-sm font-medium mb-1" style={{ color: 'var(--fg-main)' }}>
                    {approval.meta?.title || approval.tool}
                  </div>
                  <div className="text-xs mb-2" style={{ color: 'var(--fg-secondary)' }}>
                    {approval.meta?.reason || 'Bu əməliyyat təsdiq tələb edir.'}
                  </div>
                  <div className="text-[11px] mb-2" style={{ color: 'var(--fg-muted)' }}>
                    {formatMetaLine(approval)}
                  </div>
                  {(approval.meta?.summary || approval.meta?.path) && (
                    <div className="text-[11px] mb-2 space-y-1" style={{ color: 'var(--fg-secondary)' }}>
                      {approval.meta?.summary && <div><span style={{ color: 'var(--fg-muted)' }}>Qısa təsvir:</span> {approval.meta.summary}</div>}
                      {approval.meta?.path && <div className="font-mono break-all">{approval.meta.path}</div>}
                    </div>
                  )}
                  <pre
                    className="text-xs p-3 rounded-lg mb-3 overflow-auto max-h-32"
                    style={{ background: 'var(--bg-hover)', color: 'var(--fg-muted)' }}
                  >
                    {approval.meta?.preview || (() => {
                      try { return JSON.stringify(JSON.parse(approval.args), null, 2); }
                      catch { return approval.args; }
                    })()}
                  </pre>
                  {approval.meta?.diffPreview && (
                    <div className="mb-3">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-[10px] uppercase font-semibold" style={{ color: 'var(--fg-muted)' }}>
                          Diff preview
                        </span>
                        {approval.meta.diffStats && (
                          <span className="text-[10px] font-mono" style={{ color: 'var(--fg-muted)' }}>
                            +{approval.meta.diffStats.added} -{approval.meta.diffStats.removed}
                          </span>
                        )}
                      </div>
                      <div
                        className="text-[11px] p-3 rounded-lg overflow-auto max-h-44"
                        style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)' }}
                      >
                        {renderDiffPreview(approval.meta.diffPreview)}
                      </div>
                    </div>
                  )}
                  <details className="mb-3">
                    <summary className="text-[11px] cursor-pointer" style={{ color: 'var(--fg-muted)' }}>
                      Tam argumentlər
                    </summary>
                    <pre
                      className="text-[11px] p-3 rounded-lg mt-2 overflow-auto max-h-40"
                      style={{ background: 'var(--bg-hover)', color: 'var(--fg-muted)' }}
                    >
                      {(() => {
                        try { return JSON.stringify(JSON.parse(approval.args), null, 2); }
                        catch { return approval.args; }
                      })()}
                    </pre>
                  </details>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <button
                      onClick={() => onApprove(approval.approvalId, 'reject')}
                      className="flex-1 px-4 py-3 text-sm rounded-lg transition-colors font-medium"
                      style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.2)', minHeight: '44px' }}
                    >
                      Rədd et
                    </button>
                    <button
                      onClick={() => onApprove(approval.approvalId, 'approve')}
                      className="flex-1 px-4 py-3 text-sm rounded-lg transition-colors font-medium"
                      style={{ background: 'rgba(34, 197, 94, 0.1)', color: '#4ade80', border: '1px solid rgba(34, 197, 94, 0.2)', minHeight: '44px' }}
                    >
                      Təsdiq et
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {history.length > 0 && (
          <div className="mt-5 pt-5" style={{ borderTop: '1px solid var(--border)' }}>
            <div className="text-sm font-semibold mb-3" style={{ color: 'var(--fg-main)' }}>
              Recent history
            </div>
            <div className="space-y-2">
              {history.slice(0, 5).map((item) => {
                const label = item.checkpoint?.title || item.approval?.meta?.title || item.approval?.tool || item.kind;
                const meta = item.checkpoint || item.approval || {};
                return (
                  <div key={`history-${item.id}`} className="rounded-lg px-3 py-2" style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)' }}>
                    <div className="text-[11px] font-semibold" style={{ color: 'var(--fg-main)' }}>
                      {label}
                    </div>
                    <div className="text-[11px]" style={{ color: 'var(--fg-muted)' }}>
                      {formatMetaLine(meta)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
