import { useState, useEffect, useCallback } from 'react';
import { Eye, Code2, Copy, Check, RefreshCcw, ExternalLink } from 'lucide-react';

interface Props {
  language: string;
  code: string;
}

/**
 * Renders an HTML/SVG code block as an interactive artifact with a
 * Preview ⇄ Code toggle. The preview runs inside a sandboxed iframe so
 * inline scripts/styles cannot escape the message. Falls back to plain
 * code view for any language that isn't preview-able.
 */
export default function ArtifactBlock({ language, code }: Props) {
  const [view, setView] = useState<'preview' | 'code'>('preview');
  const [copied, setCopied] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [isMobile, setIsMobile] = useState(false);

  const lang = String(language || '').toLowerCase();
  const isHtml = lang === 'html' || lang === 'htm' || lang === 'html+svg';
  const isSvg = lang === 'svg';

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = code;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [code]);

  // Wrap fragments (no <html>/<body>) in a minimal document so the iframe
  // always renders something sensible.
  const doc = useCallback(() => {
    const previewGuard = `<script>(function(){window.addEventListener('error',function(e){var msg=(e.message||'JavaScript xətası')+(e.lineno?' (Sətir: '+e.lineno+(e.colno?' | Sütun: '+e.colno:''):'');var box=document.createElement('div');box.style.cssText='position:fixed;inset:12px;background:#fff7ed;color:#9a3412;border:1px solid #fdba74;border-radius:12px;padding:14px;font:13px system-ui,sans-serif;z-index:2147483647;white-space:pre-wrap;box-shadow:0 10px 25px rgba(0,0,0,0.2)';box.innerHTML='<div style="font-weight:bold;margin-bottom:6px">⚠️ Preview Sintaksis Xətası</div><div>'+msg+'</div><div style="margin-top:10px;font-size:11px;color:#c2410c">💡 Yuxarıdakı <b>&amp;lt;/&amp;gt; Kode</b> düyməsinə basaraq kodu kopyalaya bilərsiniz.</div>';document.body&&document.body.appendChild(box);});})();</script>`;
    if (isHtml) {
      const hasFullDoc = /<(html|body|!doctype)\b/i.test(code);
      if (hasFullDoc) {
        return code.includes('</head>')
          ? code.replace('</head>', `${previewGuard}</head>`)
          : `${previewGuard}${code}`;
      }
      return `<!DOCTYPE html>\n<html>\n<head>\n<meta charset="utf-8" />\n<style>body{font-family:system-ui,sans-serif;margin:0;padding:0}</style>\n${previewGuard}\n</head>\n<body>\n${code}\n</body>\n</html>`;
    }
    if (isSvg) {
      return `<!DOCTYPE html>\n<html>\n<head>\n<meta charset="utf-8" />\n<style>body{margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#fff}</style>\n</head>\n<body>\n${code}\n</body>\n</html>`;
    }
    return code;
  }, [code, isHtml, isSvg]);

  return (
    <div className="my-3 rounded-lg overflow-hidden shadow-lg" style={{ border: '1px solid var(--border)', background: '#1e1e1e' }}>
      {/* Header with Preview/Code toggle */}
      <div className="flex items-center justify-between px-3 sm:px-4 py-2" style={{ background: '#171717', borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center gap-1 rounded-md p-0.5" style={{ background: '#00000040' }}>
          <button
            onClick={() => setView('preview')}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium transition-colors"
            style={{
              color: view === 'preview' ? 'var(--fg-on-accent, #fff)' : '#9ca3af',
              background: view === 'preview' ? 'var(--color-accent)' : 'transparent',
              minHeight: '28px',
            }}
            aria-pressed={view === 'preview'}
          >
            <Eye size={12} />
            Preview
          </button>
          <button
            onClick={() => setView('code')}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium transition-colors"
            style={{
              color: view === 'code' ? 'var(--fg-on-accent, #fff)' : '#9ca3af',
              background: view === 'code' ? 'var(--color-accent)' : 'transparent',
              minHeight: '28px',
            }}
            aria-pressed={view === 'code'}
          >
            <Code2 size={12} />
            Kode
          </button>
        </div>
        <div className="flex items-center gap-1.5">
          {view === 'preview' && (
            <button
              onClick={() => setReloadKey(k => k + 1)}
              className="p-2 rounded-md text-gray-400 hover:text-white hover:bg-gray-700/50 transition-colors"
              style={{ minHeight: '32px', minWidth: '32px' }}
              title="Yenilə"
            >
              <RefreshCcw size={14} />
            </button>
          )}
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold text-white transition-all bg-amber-600 hover:bg-amber-500 shadow-sm active:scale-95"
            style={{ minHeight: '32px' }}
            title="Kodu kopyala"
          >
            {copied ? <Check size={14} className="text-green-300" /> : <Copy size={14} />}
            <span>{copied ? 'Kopyalandı' : 'Kodu Kopyala'}</span>
          </button>
        </div>
      </div>

      {/* Body */}
      {view === 'preview' ? (
        <div className="relative">
          <iframe
            key={reloadKey}
            title="Artifact preview"
            sandbox="allow-scripts allow-forms allow-popups allow-downloads allow-pointer-lock"
            srcDoc={doc()}
            className="w-full border-none"
            style={{ background: '#ffffff', height: isMobile ? '260px' : '360px' }}
          />
          {/* External open link */}
          <a
            href={`data:text/html;charset=utf-8,${encodeURIComponent(doc())}`}
            download={`artifact.${isHtml ? 'html' : 'svg'}`}
            className="absolute bottom-2 right-2 p-1.5 rounded-md bg-black/40 hover:bg-black/60 text-white/80 transition-colors"
            title="Fayl kimi endir"
          >
            <ExternalLink size={13} />
          </a>
        </div>
      ) : (
        <pre className="overflow-x-auto premium-scroll" style={{ margin: 0, padding: isMobile ? '12px' : '16px', background: '#000', color: '#fff', fontSize: isMobile ? '12px' : '13px', lineHeight: 1.6, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace' }}>
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
}
