import { useState, useCallback, useEffect } from 'react';
import { Copy, Check, ChevronDown, ChevronUp, Download, Eye } from 'lucide-react';


interface CodeBlockProps {
  language?: string;
  children: string;
  inline?: boolean;
}

export default function CodeBlock({ language, children, inline }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);

    const hasElectron = Boolean(
      (window as any).electronAPI ||
      (window as any).windowControls ||
      window.navigator.userAgent.includes('Electron') ||
      window.location.search.includes('desktop=true')
    );
    setIsDesktop(hasElectron);

    return () => mq.removeEventListener('change', handler);
  }, []);

  const code = children.replace(/\n$/, '');
  const lineCount = code.split('\n').length;
  const isLong = lineCount > 30;
  const langStr = String(language || '').toLowerCase();
  // Live Preview is ONLY enabled in Desktop/Electron mode
  const isPreviewable = isDesktop && /^(html|htm|svg|js|jsx|ts|tsx)$/i.test(langStr);

  const handleOpenPreview = useCallback(() => {
    window.dispatchEvent(new CustomEvent('open-live-preview', { detail: { code, language: langStr } }));
  }, [code, langStr]);

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

  const handleDownload = useCallback(() => {
    const blob = new Blob([code], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    
    // Determine extension
    let ext = 'txt';
    const lang = String(language || '').toLowerCase();
    if (lang === 'python' || lang === 'py') ext = 'py';
    else if (lang === 'javascript' || lang === 'js') ext = 'js';
    else if (lang === 'typescript' || lang === 'ts') ext = 'ts';
    else if (lang === 'html') ext = 'html';
    else if (lang === 'css') ext = 'css';
    else if (lang === 'json') ext = 'json';
    else if (lang === 'bash' || lang === 'sh') ext = 'sh';
    
    link.download = `kod.${ext}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [code, language]);

  if (inline) {
    return (
      <code
        className="px-1.5 py-0.5 rounded text-[13px] font-mono"
        style={{
          background: 'var(--bg-surface-alt)',
          color: 'var(--fg-main)',
          border: '1px solid var(--border)',
        }}
      >
        {children}
      </code>
    );
  }

  return (
    <div
      className="group relative my-3 rounded-xl overflow-hidden shadow-xl border border-neutral-800 bg-[#0d1117]"
    >
      {/* Sleek Header */}
      <div
        className="flex items-center justify-between px-3.5 sm:px-4 py-2 bg-[#161b22] border-b border-neutral-800/80"
      >
        <div className="flex items-center gap-2 select-none">
          <span className="w-2.5 h-2.5 rounded-full bg-neutral-700/80 group-hover:bg-amber-500/80 transition-colors" />
          {language && (
            <span className="text-xs font-mono font-semibold uppercase tracking-wider text-neutral-400">
              {language}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopy}
            type="button"
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all active:scale-95 cursor-pointer ${
              copied
                ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-700/60 shadow-sm'
                : 'text-neutral-200 hover:text-white bg-neutral-700/70 hover:bg-neutral-600/80 border border-neutral-600/60 shadow-sm'
            }`}
            title={copied ? 'Kopyalandı' : 'Kodu buferə kopyala'}
          >
            {copied ? (
              <>
                <Check size={13} className="text-emerald-400" />
                <span className="font-semibold">Kopyalandı!</span>
              </>
            ) : (
              <>
                <Copy size={13} className="text-neutral-300" />
                <span>Kodu Kopyala</span>
              </>
            )}
          </button>

          <button
            onClick={handleDownload}
            type="button"
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium text-neutral-200 hover:text-white bg-neutral-700/70 hover:bg-neutral-600/80 border border-neutral-600/60 shadow-sm transition-all active:scale-95 cursor-pointer"
            title="Kodu fayl kimi yüklə"
          >
            <Download size={13} className="text-neutral-300" />
            <span>Yüklə</span>
          </button>

          {isPreviewable && (
            <button
              onClick={handleOpenPreview}
              type="button"
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold text-white bg-amber-600 hover:bg-amber-500 border border-amber-500/50 shadow-sm transition-all active:scale-95 cursor-pointer"
              title="Sağ paneldə canlı preview göstər"
            >
              <Eye size={13} />
              <span>Live Preview</span>
            </button>
          )}

          {isLong && (
            <button
              onClick={() => setCollapsed(!collapsed)}
              type="button"
              className="p-1 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors ml-0.5"
              title={collapsed ? 'Genişlət' : 'Yığ'}
            >
              {collapsed ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
            </button>
          )}
        </div>
      </div>

      {/* Code — horizontal scroll on mobile, no line numbers */}
      <div
        className={`transition-all duration-300 overflow-x-auto ${
          collapsed ? 'max-h-[120px] overflow-hidden' : ''
        }`}
      >
        <pre
          className="overflow-x-auto premium-scroll"
          style={{
            margin: 0,
            padding: isMobile ? '12px' : '16px',
            background: '#000000',
            color: '#ffffff',
            fontSize: isMobile ? '12px' : '13px',
            lineHeight: '1.6',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
          }}
        >
          <code>{code}</code>
        </pre>
      </div>

      {/* Collapsed fade overlay */}
      {collapsed && (
        <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-[#1e1e1e] to-transparent pointer-events-none" />
      )}
    </div>
  );
}
