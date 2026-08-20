import { useState, useEffect, useCallback } from 'react';
import { Eye, Code2, Copy, Check, RefreshCcw, ExternalLink } from 'lucide-react';

interface Props {
  language: string;
  code: string;
}

/**
 * Renders an HTML/SVG code block as an interactive artifact with a
 * Preview ⇄ Code toggle. Preserves both preview iframe and raw code in the DOM
 * via CSS display toggling to ensure switching tabs never collapses height or
 * renders blank content.
 */
export default function ArtifactBlock({ language, code }: Props) {
  const [view, setView] = useState<'preview' | 'code'>('preview');
  const [copied, setCopied] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [isMobile, setIsMobile] = useState(false);

  const lang = String(language || '').toLowerCase();
  const isHtml = lang === 'html' || lang === 'htm' || lang === 'html+svg';
  const isSvg = lang === 'svg';
  const rawCode = String(code || '').trim();

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const handleCopy = useCallback(async () => {
    if (!rawCode) return;
    try {
      await navigator.clipboard.writeText(rawCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = rawCode;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [rawCode]);

  const doc = useCallback(() => {
    const previewGuard = `<script>(function(){window.addEventListener('error',function(e){var msg=(e.message||'JavaScript xətası')+(e.lineno?' (Sətir: '+e.lineno+(e.colno?' | Sütun: '+e.colno:''):'');var box=document.createElement('div');box.style.cssText='position:fixed;inset:12px;background:#fff7ed;color:#9a3412;border:1px solid #fdba74;border-radius:12px;padding:14px;font:13px system-ui,sans-serif;z-index:2147483647;white-space:pre-wrap;box-shadow:0 10px 25px rgba(0,0,0,0.2)';box.innerHTML='<div style="font-weight:bold;margin-bottom:6px">⚠️ Preview Sintaksis Xətası</div><div>'+msg+'</div><div style="margin-top:10px;font-size:11px;color:#c2410c">💡 Yuxarıdakı <b>&amp;lt;/&amp;gt; Kode</b> düyməsinə basaraq kodu kopyalaya bilərsiniz.</div>';document.body&&document.body.appendChild(box);});})();</script>`;
    if (isHtml) {
      const hasFullDoc = /<(html|body|!doctype)\b/i.test(rawCode);
      if (hasFullDoc) {
        return rawCode.includes('</head>')
          ? rawCode.replace('</head>', `${previewGuard}</head>`)
          : `${previewGuard}${rawCode}`;
      }
      return `<!DOCTYPE html>\n<html>\n<head>\n<meta charset="utf-8" />\n<style>body{font-family:system-ui,sans-serif;margin:0;padding:0}</style>\n${previewGuard}\n</head>\n<body>\n${rawCode}\n</body>\n</html>`;
    }
    if (isSvg) {
      return `<!DOCTYPE html>\n<html>\n<head>\n<meta charset="utf-8" />\n<style>body{margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#fff}</style>\n</head>\n<body>\n${rawCode}\n</body>\n</html>`;
    }
    return rawCode;
  }, [rawCode, isHtml, isSvg]);

  const containerHeight = isMobile ? '300px' : '420px';

  return (
    <div className="my-3 rounded-lg overflow-hidden shadow-lg border border-neutral-700 bg-neutral-900">
      {/* Header with Preview ⇄ Code toggle */}
      <div className="flex items-center justify-between px-3 sm:px-4 py-2 bg-neutral-950 border-b border-neutral-800">
        <div className="flex items-center gap-1 rounded-md p-0.5 bg-black/40">
          <button
            onClick={() => setView('preview')}
            type="button"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold transition-all ${
              view === 'preview' ? 'bg-amber-600 text-white shadow-sm' : 'text-neutral-400 hover:text-neutral-200'
            }`}
            aria-pressed={view === 'preview'}
          >
            <Eye size={13} />
            Preview
          </button>
          <button
            onClick={() => setView('code')}
            type="button"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold transition-all ${
              view === 'code' ? 'bg-amber-600 text-white shadow-sm' : 'text-neutral-400 hover:text-neutral-200'
            }`}
            aria-pressed={view === 'code'}
          >
            <Code2 size={13} />
            Kode
          </button>
        </div>
        <div className="flex items-center gap-2">
          {view === 'preview' && (
            <button
              onClick={() => setReloadKey(k => k + 1)}
              type="button"
              className="p-1.5 rounded-md text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
              title="Yenilə"
            >
              <RefreshCcw size={14} />
            </button>
          )}
          <button
            onClick={handleCopy}
            type="button"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold text-white transition-all bg-amber-600 hover:bg-amber-500 shadow-sm active:scale-95"
            title="Kodu kopyala"
          >
            {copied ? <Check size={14} className="text-green-300" /> : <Copy size={14} />}
            <span>{copied ? 'Kopyalandı' : 'Kodu Kopyala'}</span>
          </button>
        </div>
      </div>

      {/* Content Container - Always maintains min-height & preserves both views in DOM */}
      <div className="relative w-full overflow-hidden bg-neutral-950" style={{ minHeight: containerHeight }}>
        {/* Preview View */}
        <div style={{ display: view === 'preview' ? 'block' : 'none', width: '100%', height: '100%' }}>
          {rawCode ? (
            <div className="relative w-full" style={{ height: containerHeight }}>
              <iframe
                key={reloadKey}
                title="Artifact preview"
                sandbox="allow-scripts allow-forms allow-popups allow-downloads allow-pointer-lock"
                srcDoc={doc()}
                className="w-full border-none bg-white"
                style={{ height: containerHeight }}
              />
              <a
                href={`data:text/html;charset=utf-8,${encodeURIComponent(doc())}`}
                download={`artifact.${isHtml ? 'html' : 'svg'}`}
                className="absolute bottom-3 right-3 p-2 rounded-lg bg-black/60 hover:bg-black/80 text-white transition-all shadow-md"
                title="Fayl kimi endir"
              >
                <ExternalLink size={14} />
              </a>
            </div>
          ) : (
            <div className="flex items-center justify-center text-neutral-500 text-xs p-8" style={{ height: containerHeight }}>
              <span>Preview məzmunu yüklənir...</span>
            </div>
          )}
        </div>

        {/* Code View */}
        <div style={{ display: view === 'code' ? 'block' : 'none', width: '100%', height: '100%' }}>
          {rawCode ? (
            <pre
              className="overflow-auto p-4 text-xs font-mono text-neutral-200 leading-relaxed bg-black m-0"
              style={{ height: containerHeight, maxHeight: '600px' }}
            >
              <code>{rawCode}</code>
            </pre>
          ) : (
            <div className="flex items-center justify-center text-neutral-500 text-xs p-8" style={{ height: containerHeight }}>
              <span>Kod məzmunu yüklənir...</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
