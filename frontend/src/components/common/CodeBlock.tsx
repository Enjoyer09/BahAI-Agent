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
      className="group relative my-3 rounded-lg overflow-hidden shadow-lg"
      style={{
        border: '1px solid var(--border)',
        background: '#1e1e1e',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 sm:px-4 py-2"
        style={{
          background: '#171717',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div className="flex items-center gap-2">
          {language && (
            <span className="text-[11px] text-gray-500 font-mono uppercase tracking-wider">
              {language}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopy}
            type="button"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-gray-200 bg-neutral-800 hover:bg-neutral-700 hover:text-white border border-neutral-700 transition-all active:scale-95"
            title={copied ? 'Kopyalandı' : 'Kodu buferə kopyala'}
          >
            {copied ? (
              <>
                <Check size={14} className="text-green-400" />
                <span className="text-green-400 font-semibold">Kopyalandı!</span>
              </>
            ) : (
              <>
                <Copy size={14} className="text-gray-400" />
                <span>Kodu Kopyala</span>
              </>
            )}
          </button>

          <button
            onClick={handleDownload}
            type="button"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-gray-200 bg-neutral-800 hover:bg-neutral-700 hover:text-white border border-neutral-700 transition-all active:scale-95"
            title="Kodu fayl kimi yüklə"
          >
            <Download size={14} className="text-gray-400" />
            <span>Yüklə</span>
          </button>

          {isPreviewable && (
            <button
              onClick={handleOpenPreview}
              type="button"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold text-white bg-amber-600 hover:bg-amber-500 shadow-sm transition-all active:scale-95"
              title="Sağ paneldə canlı preview göstər"
            >
              <Eye size={14} />
              <span>Sağ Paneldə Aç (Live Preview)</span>
            </button>
          )}

          {isLong && (
            <button
              onClick={() => setCollapsed(!collapsed)}
              type="button"
              className="p-1.5 rounded-md text-gray-400 hover:text-white hover:bg-neutral-800 transition-colors"
              title={collapsed ? 'Genişlət' : 'Yığ'}
            >
              {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
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
