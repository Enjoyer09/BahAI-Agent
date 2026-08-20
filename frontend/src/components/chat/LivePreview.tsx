import { useState, useEffect, useRef, useCallback } from 'react';
import { RefreshCcw, ExternalLink, Globe, AlertCircle, X } from 'lucide-react';
import { Spinner } from '../common/UI';

interface Props {
  port?: number;
  code?: string;
  isVisible: boolean;
  onClose: () => void;
}

export default function LivePreview({ port, code, isVisible, onClose }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const url = port ? `http://localhost:${port}` : '';
  const rawCode = String(code || '').trim();

  const doc = useCallback(() => {
    if (!rawCode) return '';
    const previewGuard = `<script>(function(){window.addEventListener('error',function(e){var msg=(e.message||'JavaScript xətası')+(e.lineno?' (Sətir: '+e.lineno+(e.colno?' | Sütun: '+e.colno:''):'');var box=document.createElement('div');box.style.cssText='position:fixed;inset:12px;background:#fff7ed;color:#9a3412;border:1px solid #fdba74;border-radius:12px;padding:14px;font:13px system-ui,sans-serif;z-index:2147483647;white-space:pre-wrap;box-shadow:0 10px 25px rgba(0,0,0,0.2)';box.innerHTML='<div style="font-weight:bold;margin-bottom:6px">⚠️ Preview Sintaksis Xətası</div><div>'+msg+'</div>';document.body&&document.body.appendChild(box);});})();</script>`;
    const hasFullDoc = /<(html|body|!doctype)\b/i.test(rawCode);
    if (hasFullDoc) {
      return rawCode.includes('</head>')
        ? rawCode.replace('</head>', `${previewGuard}</head>`)
        : `${previewGuard}${rawCode}`;
    }
    return `<!DOCTYPE html>\n<html>\n<head>\n<meta charset="utf-8" />\n<style>body{font-family:system-ui,sans-serif;margin:0;padding:0}</style>\n${previewGuard}\n</head>\n<body>\n${rawCode}\n</body>\n</html>`;
  }, [rawCode]);

  const reload = useCallback(() => {
    if (!url && !rawCode) return;
    setLoading(true);
    setError(false);
    if (iframeRef.current) {
      if (rawCode) {
        iframeRef.current.srcdoc = doc();
        setLoading(false);
      } else if (url) {
        iframeRef.current.src = url;
      }
    }
  }, [url, rawCode, doc]);

  useEffect(() => {
    if (isVisible) reload();
  }, [isVisible, url, rawCode, reload]);

  const openExternalBrowser = useCallback(() => {
    let target = url || 'http://localhost:5173';
    if (rawCode) {
      target = `data:text/html;charset=utf-8,${encodeURIComponent(doc())}`;
    }
    if ((window as any).electronAPI?.openExternal) {
      (window as any).electronAPI.openExternal(target);
    } else {
      window.open(target, '_blank', 'noopener,noreferrer');
    }
  }, [url, rawCode, doc]);

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
            {rawCode ? 'Live Code Preview' : (url || 'http://localhost:5173')}
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
        {!url && !rawCode ? (
          <div className="flex flex-col items-center justify-center h-full">
            <Globe size={32} style={{ color: 'var(--fg-faint)' }} />
            <p className="text-xs mt-3" style={{ color: 'var(--fg-muted)' }}>Canlı preview məzmunu yüklənir...</p>
          </div>
        ) : (
          <>
            {loading && !error && !rawCode && (
              <div className="absolute inset-0 flex flex-col items-center justify-center z-10" style={{ background: 'var(--bg-main)' }}>
                <Spinner size={24} />
                <p className="text-xs mt-3" style={{ color: 'var(--fg-muted)' }}>Yüklənir...</p>
              </div>
            )}

            {rawCode ? (
              <iframe
                ref={iframeRef}
                srcDoc={doc()}
                className="w-full h-full border-none bg-white"
                sandbox="allow-scripts allow-forms allow-popups allow-downloads allow-pointer-lock"
                title="Live Code Preview"
              />
            ) : (
              <iframe
                ref={iframeRef}
                src={url}
                className="w-full h-full border-none bg-white"
                style={{ opacity: loading ? 0 : 1, transition: 'opacity 0.3s' }}
                onLoad={() => setLoading(false)}
                onError={() => setError(true)}
                sandbox="allow-forms allow-modals allow-pointer-lock allow-popups allow-presentation allow-same-origin allow-scripts"
                title="Live Preview"
              />
            )}
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
