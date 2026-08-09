// ==========================================
// OrchestrationProgress — Step-by-step agent workflow visualization
// ==========================================

import { CheckCircle2, Circle, Loader2, XCircle, Brain, Code2, Shield, Play } from 'lucide-react';

export interface OrchestrationStep {
  id: string;
  agent: 'Planner' | 'Builder' | 'Reviewer';
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  description: string;
  startedAt?: number;
  completedAt?: number;
  artifacts?: string[];
}

interface OrchestrationProgressProps {
  phase: 'idle' | 'planning' | 'building' | 'reviewing' | 'completed' | 'failed';
  steps: OrchestrationStep[];
  planSummary?: string | null;
  onApprovePlan?: () => void;
  onRejectPlan?: () => void;
  showApproval?: boolean;
}

const AGENT_META: Record<string, { icon: typeof Brain; color: string; label: string }> = {
  Planner: { icon: Brain, color: '#8b5cf6', label: 'Planlaşdırıcı' },
  Builder: { icon: Code2, color: '#3b82f6', label: 'İcraçı' },
  Reviewer: { icon: Shield, color: '#10b981', label: 'Yoxlayıcı' },
};

function StepIcon({ status }: { status: OrchestrationStep['status'] }) {
  switch (status) {
    case 'completed': return <CheckCircle2 size={14} className="text-[var(--color-success)]" />;
    case 'running': return <Loader2 size={14} className="text-[var(--color-accent)] animate-spin" />;
    case 'failed': return <XCircle size={14} className="text-[var(--color-danger)]" />;
    case 'skipped': return <Circle size={14} className="text-[var(--fg-muted)] opacity-40" />;
    default: return <Circle size={14} className="text-[var(--fg-muted)]" />;
  }
}

function formatDuration(startMs?: number, endMs?: number): string {
  if (!startMs) return '';
  const end = endMs || Date.now();
  const seconds = Math.round((end - startMs) / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export default function OrchestrationProgress({
  phase,
  steps,
  planSummary,
  onApprovePlan,
  onRejectPlan,
  showApproval,
}: OrchestrationProgressProps) {
  if (phase === 'idle' && steps.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-center px-4 py-8">
        <Play size={20} className="text-[var(--fg-muted)]" />
        <span className="text-[11px] text-[var(--fg-muted)]">Agent işə başladıqda burada addımlar görünəcək</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Phase indicator */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
        <div className={`w-2 h-2 rounded-full ${
          phase === 'completed' ? 'bg-[var(--color-success)]' :
          phase === 'failed' ? 'bg-[var(--color-danger)]' :
          phase === 'idle' ? 'bg-[var(--fg-muted)]' :
          'bg-[var(--color-accent)] animate-pulse'
        }`} />
        <span className="text-[11px] font-semibold text-[var(--fg-main)]">
          {phase === 'idle' ? 'Gözləyir' :
           phase === 'planning' ? '🧠 Planlaşdırılır...' :
           phase === 'building' ? '🔨 İnşa edilir...' :
           phase === 'reviewing' ? '🔍 Yoxlanılır...' :
           phase === 'completed' ? '✅ Tamamlandı' : '❌ Xəta'}
        </span>
      </div>

      {/* Plan approval */}
      {showApproval && planSummary && (
        <div className="shrink-0 mx-3 mt-2 p-2.5 rounded-lg border border-[var(--color-accent)]/20 bg-[var(--color-accent)]/5">
          <p className="text-[10px] font-semibold text-[var(--color-accent)] mb-1.5 uppercase tracking-wider">Plan hazırdır:</p>
          <p className="text-[11px] text-[var(--fg-main)] leading-relaxed mb-2">{planSummary}</p>
          <div className="flex gap-2">
            <button
              onClick={onApprovePlan}
              className="flex-1 py-1.5 rounded-md text-[10px] font-bold bg-[var(--color-success)] text-white"
            >
              ✓ Təsdiqlə
            </button>
            <button
              onClick={onRejectPlan}
              className="flex-1 py-1.5 rounded-md text-[10px] font-bold bg-[var(--color-danger)] text-white"
            >
              ✗ Ləğv et
            </button>
          </div>
        </div>
      )}

      {/* Steps list */}
      <div className="flex-1 overflow-y-auto p-3 premium-scroll">
        <div className="space-y-0.5">
          {steps.map((step, i) => {
            const meta = AGENT_META[step.agent] || AGENT_META.Builder;
            const Icon = meta.icon;
            return (
              <div key={step.id} className="flex items-start gap-2 py-1.5">
                {/* Timeline connector */}
                <div className="flex flex-col items-center shrink-0 pt-0.5">
                  <StepIcon status={step.status} />
                  {i < steps.length - 1 && (
                    <div className="w-px flex-1 mt-1 min-h-[16px]" style={{ background: 'var(--border-subtle)' }} />
                  )}
                </div>

                {/* Step content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <Icon size={10} style={{ color: meta.color }} />
                    <span className="text-[10px] font-semibold" style={{ color: meta.color }}>{meta.label}</span>
                    {step.startedAt && (
                      <span className="text-[9px] text-[var(--fg-muted)] ml-auto">
                        {formatDuration(step.startedAt, step.completedAt)}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-[var(--fg-secondary)] mt-0.5 leading-tight">{step.description}</p>
                  {step.artifacts && step.artifacts.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {step.artifacts.map((a, j) => (
                        <span key={j} className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--bg-hover)] text-[var(--fg-muted)]">
                          {a.split('/').pop()}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
