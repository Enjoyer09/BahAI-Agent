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

  if (!isVisible) return null;

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--bg-surface)' }}>
      {/* Header */}
      <div
        className="h-9 flex items-center justify-between px-3 shrink-0"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Globe size={13} style={{ color: 'var(--color-accent)' }} />
          <span className="text-[11px] font-medium truncate" style={{ color: 'var(--fg-secondary)' }}>
            {url || 'No port'}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={reload}
            className="p-1 rounded transition-colors"
            style={{ color: 'var(--fg-muted)' }}
            title="Refresh"
            aria-label="Refresh preview"
          >
            <RefreshCcw size={12} className={loading ? 'animate-spin' : ''} />
          </button>
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="p-1 rounded transition-colors"
              style={{ color: 'var(--fg-muted)' }}
              title="Open in new tab"
              aria-label="Open in new tab"
            >
              <ExternalLink size={12} />
            </a>
          )}
          <button
            onClick={onClose}
            className="p-1 rounded transition-colors"
            style={{ color: 'var(--fg-muted)' }}
            aria-label="Close preview"
          >
            <X size={12} />
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
