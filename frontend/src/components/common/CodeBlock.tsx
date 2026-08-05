import { useState, useCallback, useEffect } from 'react';
import { Copy, Check, ChevronDown, ChevronUp, Download } from 'lucide-react';


interface CodeBlockProps {
  language?: string;
  children: string;
  inline?: boolean;
}

export default function CodeBlock({ language, children, inline }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const code = children.replace(/\n$/, '');
  const lineCount = code.split('\n').length;
  const isLong = lineCount > 30;

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
        <div className="flex items-center gap-1">
          {isLong && (
            <button
              onClick={() => setCollapsed(!collapsed)}
              className="p-2 rounded-md text-gray-500 hover:text-gray-300 hover:bg-gray-700/50 transition-colors"
              style={{ minHeight: '44px', minWidth: '44px' }}
              title={collapsed ? 'Genişlət' : 'Yığ'}
            >
              {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
            </button>
          )}
          <button
            onClick={handleDownload}
            className="p-2 rounded-md text-gray-500 hover:text-gray-300 hover:bg-gray-700/50 transition-colors"
            style={{ minHeight: '44px', minWidth: '44px' }}
            title="Yüklə"
          >
            <Download size={16} />
          </button>
          <button
            onClick={handleCopy}
            className="p-2 rounded-md text-gray-500 hover:text-gray-300 hover:bg-gray-700/50 transition-colors"
            style={{ minHeight: '44px', minWidth: '44px' }}
            title={copied ? 'Kopyalandı' : 'Kodu kopyala'}
            aria-label={copied ? 'Kod kopyalandı' : 'Kodu kopyala'}
          >
            {copied ? (
              <span className="inline-flex items-center gap-1 text-[11px] text-green-400">
                <Check size={16} />
                <span className="hidden sm:inline">Kopyalandı</span>
              </span>
            ) : (
              <Copy size={16} />
            )}
          </button>
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
