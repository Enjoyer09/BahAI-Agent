// ==========================================
// DesktopPreview — Enhanced Live Preview for Desktop App Builder
// ==========================================
// Features: responsive mode selector, URL bar, console overlay, auto-reload

import { useState, useEffect, useRef, useCallback } from 'react';
import { RefreshCcw, ExternalLink, Globe, AlertCircle, X, Monitor, Tablet, Smartphone, AlertTriangle, ChevronDown } from 'lucide-react';

interface ConsoleEntry {
  level: 'log' | 'warn' | 'error' | 'info';
  message: string;
  timestamp: number;
}

type ResponsiveMode = 'desktop' | 'tablet' | 'mobile';

interface DesktopPreviewProps {
  port?: number;
  isVisible: boolean;
  onClose?: () => void;
  autoReloadSignal?: number; // increment to trigger reload
}

const VIEWPORT_SIZES: Record<ResponsiveMode, { width: string; height: string; label: string }> = {
  desktop: { width: '100%', height: '100%', label: 'Desktop' },
  tablet: { width: '768px', height: '1024px', label: 'Tablet' },
  mobile: { width: '375px', height: '812px', label: 'Mobile' },
};

export default function DesktopPreview({ port, isVisible, onClose, autoReloadSignal }: DesktopPreviewProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [responsiveMode, setResponsiveMode] = useState<ResponsiveMode>('desktop');
  const [currentUrl, setCurrentUrl] = useState('');
  const [consoleEntries, setConsoleEntries] = useState<ConsoleEntry[]>([]);
  const [showConsole, setShowConsole] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const baseUrl = port ? `http://localhost:${port}` : '';

  const reload = useCallback(() => {
    if (!baseUrl) return;
    setLoading(true);
    setError(false);
    if (iframeRef.current) {
      iframeRef.current.src = currentUrl || baseUrl;
    }
  }, [baseUrl, currentUrl]);

  // Auto-reload on signal change
  useEffect(() => {
    if (autoReloadSignal && isVisible && baseUrl) {
      const timer = setTimeout(reload, 1000);
      return () => clearTimeout(timer);
    }
  }, [autoReloadSignal, isVisible, baseUrl, reload]);

  // Initial load
  useEffect(() => {
    if (isVisible && baseUrl) {
      setCurrentUrl(baseUrl);
      reload();
    }
  }, [isVisible, baseUrl]);

  // Listen to console messages from iframe (basic — works for same-origin)
  useEffect(() => {
    if (!isVisible) return;

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'console' && event.data.level && event.data.message) {
        setConsoleEntries(prev => [
          ...prev.slice(-49), // keep last 50
          { level: event.data.level, message: event.data.message, timestamp: Date.now() }
        ]);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [isVisible]);

  if (!isVisible) return null;

  const viewport = VIEWPORT_SIZES[responsiveMode];
  const errorCount = consoleEntries.filter(e => e.level === 'error').length;

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--bg-surface)' }}>
      {/* Toolbar */}
      <div className="shrink-0 flex items-center gap-1 px-2 py-1.5" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        {/* URL Bar */}
        <div className="flex-1 flex items-center gap-1.5 min-w-0">
          <Globe size={12} className="shrink-0 text-[var(--fg-muted)]" />
          <input
            type="text"
            value={currentUrl || baseUrl}
            onChange={(e) => setCurrentUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') reload(); }}
            className="flex-1 min-w-0 text-[11px] bg-transparent border-none outline-none text-[var(--fg-secondary)] truncate"
            placeholder="http://localhost:..."
          />
        </div>

        {/* Responsive mode selector */}
        <div className="flex items-center gap-0.5 px-1 shrink-0">
          <button
            onClick={() => setResponsiveMode('desktop')}
            className={`p-1 rounded transition-colors ${responsiveMode === 'desktop' ? 'text-[var(--color-accent)] bg-[var(--color-accent)]/10' : 'text-[var(--fg-muted)] hover:text-[var(--fg-main)]'}`}
            title="Desktop"
          >
            <Monitor size={12} />
          </button>
          <button
            onClick={() => setResponsiveMode('tablet')}
            className={`p-1 rounded transition-colors ${responsiveMode === 'tablet' ? 'text-[var(--color-accent)] bg-[var(--color-accent)]/10' : 'text-[var(--fg-muted)] hover:text-[var(--fg-main)]'}`}
            title="Tablet"
          >
            <Tablet size={12} />
          </button>
          <button
            onClick={() => setResponsiveMode('mobile')}
            className={`p-1 rounded transition-colors ${responsiveMode === 'mobile' ? 'text-[var(--color-accent)] bg-[var(--color-accent)]/10' : 'text-[var(--fg-muted)] hover:text-[var(--fg-main)]'}`}
            title="Mobile"
          >
            <Smartphone size={12} />
          </button>
        </div>

        {/* Actions */}
        <button onClick={reload} className="p-1 rounded text-[var(--fg-muted)] hover:text-[var(--fg-main)]" title="Yenilə">
          <RefreshCcw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
        {baseUrl && (
          <a href={currentUrl || baseUrl} target="_blank" rel="noreferrer" className="p-1 rounded text-[var(--fg-muted)] hover:text-[var(--fg-main)]" title="Xarici brauzerdə aç">
            <ExternalLink size={12} />
          </a>
        )}
        {/* Console toggle */}
        <button
          onClick={() => setShowConsole(p => !p)}
          className={`p-1 rounded relative ${showConsole ? 'text-[var(--color-accent)]' : 'text-[var(--fg-muted)]'}`}
          title="Konsol"
        >
          <AlertTriangle size={12} />
          {errorCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-red-500 text-white text-[7px] flex items-center justify-center font-bold">
              {errorCount > 9 ? '9+' : errorCount}
            </span>
          )}
        </button>
        {onClose && (
          <button onClick={onClose} className="p-1 rounded text-[var(--fg-muted)] hover:text-[var(--fg-main)]">
            <X size={12} />
          </button>
        )}
      </div>

      {/* Preview content */}
      <div className="flex-1 relative overflow-hidden flex items-center justify-center" style={{ background: '#1a1a1a' }}>
        {!baseUrl ? (
          <div className="flex flex-col items-center justify-center gap-3 text-center px-6">
            <Globe size={32} className="text-[var(--fg-faint)]" />
            <p className="text-xs text-[var(--fg-muted)]">Dev server port təyin olunmayıb</p>
            <p className="text-[10px] text-[var(--fg-muted)]">Agent layihəni run etdikdə burada preview görünəcək</p>
          </div>
        ) : (
          <>
            {loading && !error && (
              <div className="absolute inset-0 flex flex-col items-center justify-center z-10" style={{ background: '#1a1a1a' }}>
                <div className="w-6 h-6 border-2 border-[var(--color-accent)] border-t-transparent rounded-full animate-spin" />
                <p className="text-xs mt-3 text-[var(--fg-muted)]">Yüklənir...</p>
              </div>
            )}

            {error && (
              <div className="absolute inset-0 flex flex-col items-center justify-center z-20 px-8 text-center" style={{ background: '#1a1a1a' }}>
                <AlertCircle size={28} className="text-[var(--color-danger)]" />
                <h3 className="text-sm font-semibold mt-3 mb-1 text-[var(--fg-main)]">Qoşulmaq alınmadı</h3>
                <p className="text-xs mb-4 max-w-xs text-[var(--fg-muted)]">
                  Server {baseUrl} ünvanında aktiv deyil
                </p>
                <button onClick={reload} className="px-4 py-2 text-xs rounded-lg font-medium bg-[var(--color-accent)] text-white">
                  Yenidən cəhd
                </button>
              </div>
            )}

            {/* Responsive container */}
            <div
              className="relative transition-all duration-300 ease-out"
              style={{
                width: viewport.width,
                height: viewport.height,
                maxWidth: '100%',
                maxHeight: '100%',
                border: responsiveMode !== 'desktop' ? '2px solid var(--border)' : 'none',
                borderRadius: responsiveMode !== 'desktop' ? '12px' : '0',
                overflow: 'hidden',
              }}
            >
              <iframe
                ref={iframeRef}
                src={currentUrl || baseUrl}
                className="w-full h-full border-none"
                style={{ opacity: loading ? 0 : 1, transition: 'opacity 0.3s', background: 'white' }}
                onLoad={() => setLoading(false)}
                onError={() => setError(true)}
                sandbox="allow-forms allow-modals allow-pointer-lock allow-popups allow-presentation allow-same-origin allow-scripts"
                title="Live Preview"
              />
            </div>
          </>
        )}
      </div>

      {/* Console overlay */}
      {showConsole && (
        <div
          className="shrink-0 overflow-y-auto max-h-[150px] premium-scroll"
          style={{ background: '#1e1e1e', borderTop: '1px solid var(--border-subtle)' }}
        >
          {consoleEntries.length === 0 ? (
            <div className="flex items-center justify-center py-4 text-[10px] text-[var(--fg-muted)]">
              Konsol boşdur
            </div>
          ) : (
            <div className="p-2 space-y-0.5">
              {consoleEntries.map((entry, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 text-[10px] font-mono py-0.5 px-1 rounded"
                  style={{
                    color: entry.level === 'error' ? '#f87171' : entry.level === 'warn' ? '#fbbf24' : '#a1a1aa',
                    background: entry.level === 'error' ? 'rgba(248,113,113,0.05)' : 'transparent',
                  }}
                >
                  <span className="shrink-0 opacity-50 w-10">
                    {new Date(entry.timestamp).toLocaleTimeString('en', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                  <span className="shrink-0 w-8 uppercase font-bold opacity-70">{entry.level}</span>
                  <span className="flex-1 break-all">{entry.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Status bar */}
      <div className="h-5 flex items-center justify-between px-2 shrink-0 text-[10px]" style={{ borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-surface)' }}>
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full" style={{ background: error ? 'var(--color-danger)' : loading ? 'var(--color-warning)' : 'var(--color-success)' }} />
          <span className="text-[var(--fg-muted)]">{error ? 'Əlaqə kəsilib' : loading ? 'Yüklənir...' : 'Canlı'}</span>
        </div>
        <span className="text-[var(--fg-muted)]">{viewport.label} {responsiveMode !== 'desktop' ? `(${viewport.width}×${viewport.height})` : ''}</span>
      </div>
    </div>
  );
}
