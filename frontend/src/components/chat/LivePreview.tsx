import { useState, useEffect, useRef, useCallback } from 'react';
import { RefreshCcw, ExternalLink, Globe, AlertCircle, X } from 'lucide-react';
import { Spinner } from '../common/UI';

interface Props {
  port?: number;
  isVisible: boolean;
  onClose: () => void;
}

export default function LivePreview({ port, isVisible, onClose }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const url = port ? `http://localhost:${port}` : '';

  const reload = useCallback(() => {
    if (!url) return;
    setLoading(true);
    setError(false);
    if (iframeRef.current) iframeRef.current.src = url;
  }, [url]);

  useEffect(() => {
    if (isVisible && url) reload();
  }, [isVisible, url, reload]);

  const openExternalBrowser = useCallback(() => {
    const target = url || 'http://localhost:5173';
    if ((window as any).electronAPI?.openExternal) {
      (window as any).electronAPI.openExternal(target);
    } else {
      window.open(target, '_blank', 'noopener,noreferrer');
    }
  }, [url]);

  if (!isVisible) return null;

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--bg-surface)' }}>
      {/* Header */}
      <div
        className="h-10 flex items-center justify-between px-3 shrink-0"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Globe size={14} className="text-amber-500 shrink-0" />
          <span className="text-xs font-mono font-medium truncate" style={{ color: 'var(--fg-secondary)' }}>
            {url || 'http://localhost:5173'}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={reload}
            className="p-1.5 rounded-md hover:bg-neutral-800 transition-colors"
            style={{ color: 'var(--fg-muted)' }}
            title="Yenilə"
            aria-label="Refresh preview"
          >
            <RefreshCcw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={openExternalBrowser}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold text-white bg-amber-600 hover:bg-amber-500 shadow-sm transition-all active:scale-95"
            title="Sistem brauzerində / Chrome-da aç"
          >
            <ExternalLink size={13} />
            <span>Chrome-da Aç</span>
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-neutral-800 transition-colors"
            style={{ color: 'var(--fg-muted)' }}
            aria-label="Close preview"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Preview content */}
      <div className="flex-1 relative" style={{ background: 'var(--bg-main)' }}>
        {!url ? (
          <div className="flex flex-col items-center justify-center h-full">
            <Globe size={32} style={{ color: 'var(--fg-faint)' }} />
            <p className="text-xs mt-3" style={{ color: 'var(--fg-muted)' }}>No port configured</p>
          </div>
        ) : (
          <>
            {loading && !error && (
              <div className="absolute inset-0 flex flex-col items-center justify-center z-10" style={{ background: 'var(--bg-main)' }}>
                <Spinner size={24} />
                <p className="text-xs mt-3" style={{ color: 'var(--fg-muted)' }}>Loading preview...</p>
              </div>
            )}

            {error && (
              <div className="absolute inset-0 flex flex-col items-center justify-center z-20 px-8 text-center" style={{ background: 'var(--bg-surface-alt)' }}>
                <AlertCircle size={32} style={{ color: 'var(--color-danger)' }} />
                <h3 className="text-sm font-semibold mt-3 mb-1" style={{ color: 'var(--fg-main)' }}>Connection failed</h3>
                <p className="text-xs mb-4 max-w-xs" style={{ color: 'var(--fg-muted)' }}>
                  Make sure the server is running at {url}
                </p>
                <button
                  onClick={reload}
                  className="px-4 py-2 text-xs rounded-lg font-medium"
                  style={{ background: 'var(--color-accent)', color: 'var(--fg-on-accent)' }}
                >
                  Retry
                </button>
              </div>
            )}

            <iframe
              ref={iframeRef}
              src={url}
              className="w-full h-full border-none"
              style={{ opacity: loading ? 0 : 1, transition: 'opacity 0.3s' }}
              onLoad={() => setLoading(false)}
              onError={() => setError(true)}
              sandbox="allow-forms allow-modals allow-pointer-lock allow-popups allow-presentation allow-same-origin allow-scripts"
              title="Live Preview"
            />
          </>
        )}
      </div>

      {/* Status bar */}
      <div
        className="h-6 flex items-center px-3 shrink-0"
        style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-surface-alt)' }}
      >
        <div className="flex items-center gap-1.5">
          <div
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: error ? 'var(--color-danger)' : 'var(--color-success)' }}
          />
          <span className="text-[10px]" style={{ color: 'var(--fg-muted)' }}>
            {error ? 'Disconnected' : 'Live'}
          </span>
        </div>
      </div>
    </div>
  );
}
