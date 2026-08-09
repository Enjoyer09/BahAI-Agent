// ==========================================
// DeployPanel — One-click deploy workflow
// ==========================================

import { useState, useCallback } from 'react';
import { Rocket, Globe, CheckCircle2, XCircle, Loader2, ExternalLink, Server, Cloud } from 'lucide-react';

type DeployPlatform = 'railway' | 'vercel' | 'netlify';
type DeployStatus = 'idle' | 'configuring' | 'deploying' | 'success' | 'failed';

interface DeployPanelProps {
  projectPath: string;
  onDeploy?: (platform: DeployPlatform) => void;
}

const PLATFORMS: { id: DeployPlatform; name: string; icon: typeof Server; desc: string; best: string }[] = [
  { id: 'railway', name: 'Railway', icon: Server, desc: 'Full-stack & API', best: 'Express, Flask, Docker' },
  { id: 'vercel', name: 'Vercel', icon: Cloud, desc: 'Frontend & Serverless', best: 'React, Next.js, Static' },
  { id: 'netlify', name: 'Netlify', icon: Globe, desc: 'Static & JAMstack', best: 'HTML, React, Hugo' },
];

export default function DeployPanel({ projectPath, onDeploy }: DeployPanelProps) {
  const [status, setStatus] = useState<DeployStatus>('idle');
  const [selectedPlatform, setSelectedPlatform] = useState<DeployPlatform | null>(null);
  const [deployUrl, setDeployUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  const startDeploy = useCallback(async (platform: DeployPlatform) => {
    setSelectedPlatform(platform);
    setStatus('configuring');
    setError(null);
    setDeployUrl(null);
    setLogs(['Deploy prosesi başladı...', `Platform: ${platform}`, `Layihə: ${projectPath}`]);

    // In real implementation, this would call the backend deploy API
    // For now, trigger the onDeploy callback which can be wired to the chat agent
    if (onDeploy) {
      onDeploy(platform);
    }

    // Simulate config step
    setTimeout(() => {
      setLogs(prev => [...prev, 'Konfiqurasiya faylları yaradılır...']);
      setStatus('deploying');
    }, 1000);
  }, [projectPath, onDeploy]);

  const reset = () => {
    setStatus('idle');
    setSelectedPlatform(null);
    setDeployUrl(null);
    setError(null);
    setLogs([]);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
        <Rocket size={14} className="text-[var(--color-accent)]" />
        <span className="text-[12px] font-semibold text-[var(--fg-main)]">Deploy</span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 premium-scroll">
        {status === 'idle' && (
          <div className="space-y-3">
            <p className="text-[11px] text-[var(--fg-muted)] mb-3">
              Layihəni bir kliklə internetdə yayımla:
            </p>
            {PLATFORMS.map(p => (
              <button
                key={p.id}
                onClick={() => startDeploy(p.id)}
                className="w-full flex items-start gap-3 p-3 rounded-xl border transition-all hover:border-[var(--color-accent)]/30 hover:bg-[var(--color-accent)]/5 text-left"
                style={{ borderColor: 'var(--border-subtle)' }}
              >
                <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-[var(--color-accent)]/10">
                  <p.icon size={14} className="text-[var(--color-accent)]" />
                </div>
                <div className="min-w-0 flex-1">
                  <span className="text-[12px] font-semibold text-[var(--fg-main)] block">{p.name}</span>
                  <span className="text-[10px] text-[var(--fg-muted)] block">{p.desc}</span>
                  <span className="text-[9px] text-[var(--fg-muted)] block mt-0.5">Ən yaxşı: {p.best}</span>
                </div>
              </button>
            ))}
          </div>
        )}

        {(status === 'configuring' || status === 'deploying') && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Loader2 size={14} className="animate-spin text-[var(--color-accent)]" />
              <span className="text-[12px] font-semibold text-[var(--fg-main)]">
                {status === 'configuring' ? 'Konfiqurasiya...' : 'Deploy edilir...'}
              </span>
            </div>
            <div className="bg-[#1a1a1a] rounded-lg p-2 max-h-[200px] overflow-y-auto">
              {logs.map((log, i) => (
                <p key={i} className="text-[10px] font-mono text-[var(--fg-muted)] py-0.5">{log}</p>
              ))}
            </div>
            <p className="text-[10px] text-[var(--fg-muted)]">
              💡 Agent chat-da "deploy et" yazaraq da deploy edə bilərsiniz.
            </p>
          </div>
        )}

        {status === 'success' && deployUrl && (
          <div className="space-y-3 text-center py-4">
            <CheckCircle2 size={32} className="text-[var(--color-success)] mx-auto" />
            <p className="text-[13px] font-semibold text-[var(--fg-main)]">Deploy uğurlu! 🎉</p>
            <a
              href={deployUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12px] font-medium bg-[var(--color-accent)] text-white"
            >
              <ExternalLink size={12} />
              {deployUrl}
            </a>
            <button onClick={reset} className="block mx-auto text-[11px] text-[var(--fg-muted)] hover:text-[var(--fg-main)] mt-2">
              Yenidən deploy
            </button>
          </div>
        )}

        {status === 'failed' && (
          <div className="space-y-3 text-center py-4">
            <XCircle size={32} className="text-[var(--color-danger)] mx-auto" />
            <p className="text-[13px] font-semibold text-[var(--fg-main)]">Deploy uğursuz</p>
            {error && <p className="text-[11px] text-[var(--color-danger)]">{error}</p>}
            <button onClick={reset} className="text-[11px] text-[var(--color-accent)] hover:underline">
              Yenidən cəhd
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
