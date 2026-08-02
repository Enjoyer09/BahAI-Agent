import { useState, useEffect, useCallback } from 'react';
import { X, RefreshCcw, Cable, CheckCircle2, AlertCircle, PlugZap, Wrench, FolderGit2 } from 'lucide-react';
import { getMcpStatus, reloadMcp, type McpStatus } from '../../lib/api';
import { Spinner, Button } from '../common/UI';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  workingDirectory: string;
}

export default function McpPanel({ isOpen, onClose, workingDirectory }: Props) {
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);

  const load = useCallback(async () => {
    if (!isOpen) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getMcpStatus(workingDirectory);
      setStatus(data);
    } catch (e: any) {
      setError(e?.message || 'MCP status alınmadı');
    } finally {
      setLoading(false);
    }
  }, [isOpen, workingDirectory]);

  useEffect(() => {
    load();
  }, [load]);

  const handleReload = useCallback(async () => {
    setReloading(true);
    setError(null);
    try {
      const data = await reloadMcp(workingDirectory);
      setStatus(data);
    } catch (e: any) {
      setError(e?.message || 'MCP yenidən yüklənə bilmədi');
    } finally {
      setReloading(false);
    }
  }, [workingDirectory]);

  if (!isOpen) return null;

  const servers = Array.isArray(status?.servers) ? status!.servers : [];
  const hasConfig = status !== null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 backdrop-blur-sm" style={{ background: 'var(--bg-overlay, rgba(0,0,0,0.5))' }} />
      <div
        className="relative w-full max-w-lg rounded-2xl overflow-hidden animate-scale-in"
        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'var(--color-accent-muted)' }}>
              <Cable size={18} style={{ color: 'var(--color-accent)' }} />
            </div>
            <div>
              <h2 className="text-sm font-semibold" style={{ color: 'var(--fg-main)' }}>MCP Serverlər</h2>
              <p className="text-[11px]" style={{ color: 'var(--fg-muted)' }}>
                Model Context Protocol · <span className="font-mono">.mcp/config.json</span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={handleReload}
              disabled={reloading}
              className="p-2 rounded-lg transition-colors disabled:opacity-60"
              style={{ color: 'var(--fg-muted)', minHeight: '36px', minWidth: '36px' }}
              title="Yenidən yüklə"
              aria-label="Reload MCP"
            >
              <RefreshCcw size={15} className={reloading ? 'animate-spin' : ''} />
            </button>
            <button onClick={onClose} className="p-2 rounded-lg transition-colors" style={{ color: 'var(--fg-muted)', minHeight: '36px', minWidth: '36px' }} aria-label="Close MCP panel">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="px-5 py-4 max-h-[60vh] overflow-y-auto premium-scroll" style={{ background: 'var(--bg-surface)' }}>
          {loading && !status ? (
            <div className="flex flex-col items-center justify-center py-10">
              <Spinner size={22} />
              <p className="text-xs mt-3" style={{ color: 'var(--fg-muted)' }}>Status yoxlanılır...</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center py-10 text-center">
              <AlertCircle size={28} style={{ color: 'var(--color-danger)' }} />
              <p className="text-sm mt-3" style={{ color: 'var(--fg-main)' }}>{error}</p>
              <div className="mt-4 flex gap-2">
                <Button variant="primary" onClick={handleReload} disabled={reloading}>
                  {reloading ? 'Yenidən yüklənir...' : 'Təkrar cəhd et'}
                </Button>
              </div>
            </div>
          ) : !hasConfig || servers.length === 0 ? (
            <div className="flex flex-col items-center py-10 text-center">
              <PlugZap size={30} style={{ color: 'var(--fg-faint)' }} />
              <h3 className="text-sm font-semibold mt-4" style={{ color: 'var(--fg-main)' }}>MCP server konfiqurasiyası tapılmadı</h3>
              <p className="text-xs mt-1.5 max-w-xs leading-relaxed" style={{ color: 'var(--fg-muted)' }}>
                Layihə qovluğunda <span className="font-mono">.mcp/config.json</span> faylı yaradın və{" "}
                <span className="font-mono">servers</span> massivində komanda təyin edin.
              </p>
              <div className="mt-4 flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--fg-faint)' }}>
                <FolderGit2 size={13} />
                <span className="font-mono truncate max-w-[300px]">{workingDirectory || '—'}</span>
              </div>
            </div>
          ) : (
            <div className="space-y-2.5">
              {servers.map((server) => (
                <div key={server.name} className="rounded-xl px-4 py-3" style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)' }}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {server.connected ? (
                        <CheckCircle2 size={15} style={{ color: 'var(--color-success)' }} />
                      ) : (
                        <AlertCircle size={15} style={{ color: server.type === 'static' ? 'var(--color-warning, #f59e0b)' : 'var(--color-danger)' }} />
                      )}
                      <span className="text-sm font-medium truncate" style={{ color: 'var(--fg-main)' }}>{server.name}</span>
                    </div>
                    <span
                      className="text-[10px] px-2 py-0.5 rounded-full shrink-0"
                      style={{
                        color: server.connected ? 'var(--color-success)' : 'var(--fg-muted)',
                        background: server.connected ? 'rgba(16,185,129,0.1)' : 'var(--bg-surface)',
                        border: '1px solid var(--border)'
                      }}
                    >
                      {server.type === 'stdio' ? (server.connected ? 'Bağlı' : 'Bağlı deyil') : 'Statik'}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {server.tools.length > 0 ? (
                      server.tools.slice(0, 12).map((tool) => (
                        <span
                          key={tool}
                          className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-md font-mono"
                          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', color: 'var(--fg-secondary)' }}
                        >
                          <Wrench size={9} />
                          {tool}
                        </span>
                      ))
                    ) : (
                      <span className="text-[11px]" style={{ color: 'var(--fg-faint)' }}>Alət yoxdur</span>
                    )}
                    {server.tools.length > 12 && (
                      <span className="text-[10px] px-1.5 py-1" style={{ color: 'var(--fg-faint)' }}>+{server.tools.length - 12}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3" style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
          <span className="text-[11px]" style={{ color: 'var(--fg-muted)' }}>
            {status ? `${status.toolCount} alət · ${servers.length} server` : ''}
          </span>
          <Button variant="ghost" onClick={onClose}>Bağla</Button>
        </div>
      </div>
    </div>
  );
}
