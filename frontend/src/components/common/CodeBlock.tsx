import { useState, useCallback, useEffect, lazy, Suspense } from 'react';
import { Copy, Check, ChevronDown, ChevronUp } from 'lucide-react';

const SyntaxHighlighter: any = lazy(async () => {
  const [{ default: PrismLight }, js, ts, tsx, jsx, json, bash, python, markup, css, markdown, sql, yaml, diff] = await Promise.all([
    import('react-syntax-highlighter/dist/esm/prism-light'),
    import('react-syntax-highlighter/dist/esm/languages/prism/javascript'),
    import('react-syntax-highlighter/dist/esm/languages/prism/typescript'),
    import('react-syntax-highlighter/dist/esm/languages/prism/tsx'),
    import('react-syntax-highlighter/dist/esm/languages/prism/jsx'),
    import('react-syntax-highlighter/dist/esm/languages/prism/json'),
    import('react-syntax-highlighter/dist/esm/languages/prism/bash'),
    import('react-syntax-highlighter/dist/esm/languages/prism/python'),
    import('react-syntax-highlighter/dist/esm/languages/prism/markup'),
    import('react-syntax-highlighter/dist/esm/languages/prism/css'),
    import('react-syntax-highlighter/dist/esm/languages/prism/markdown'),
    import('react-syntax-highlighter/dist/esm/languages/prism/sql'),
    import('react-syntax-highlighter/dist/esm/languages/prism/yaml'),
    import('react-syntax-highlighter/dist/esm/languages/prism/diff'),
  ]);

  PrismLight.registerLanguage('javascript', js.default);
  PrismLight.registerLanguage('js', js.default);
  PrismLight.registerLanguage('typescript', ts.default);
  PrismLight.registerLanguage('ts', ts.default);
  PrismLight.registerLanguage('tsx', tsx.default);
  PrismLight.registerLanguage('jsx', jsx.default);
  PrismLight.registerLanguage('json', json.default);
  PrismLight.registerLanguage('bash', bash.default);
  PrismLight.registerLanguage('sh', bash.default);
  PrismLight.registerLanguage('shell', bash.default);
  PrismLight.registerLanguage('python', python.default);
  PrismLight.registerLanguage('py', python.default);
  PrismLight.registerLanguage('html', markup.default);
  PrismLight.registerLanguage('xml', markup.default);
  PrismLight.registerLanguage('markup', markup.default);
  PrismLight.registerLanguage('css', css.default);
  PrismLight.registerLanguage('markdown', markdown.default);
  PrismLight.registerLanguage('md', markdown.default);
  PrismLight.registerLanguage('sql', sql.default);
  PrismLight.registerLanguage('yaml', yaml.default);
  PrismLight.registerLanguage('yml', yaml.default);
  PrismLight.registerLanguage('diff', diff.default);

  return { default: PrismLight };
});
const oneDarkLoader = () => import('react-syntax-highlighter/dist/esm/styles/prism').then((mod) => mod.oneDark);

interface CodeBlockProps {
  language?: string;
  children: string;
  inline?: boolean;
}

export default function CodeBlock({ language, children, inline }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [syntaxStyle, setSyntaxStyle] = useState<any>(null);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    if (inline) return;
    let cancelled = false;
    oneDarkLoader().then((style) => {
      if (!cancelled) setSyntaxStyle(style);
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [inline]);

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
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [code]);

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
            onClick={handleCopy}
            className="p-2 rounded-md text-gray-500 hover:text-gray-300 hover:bg-gray-700/50 transition-colors"
            style={{ minHeight: '44px', minWidth: '44px' }}
            title="Kopyala"
          >
            {copied ? (
              <Check size={16} className="text-green-400" />
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
        <Suspense
          fallback={
            <pre
              className="overflow-x-auto"
              style={{
                margin: 0,
                padding: isMobile ? '12px' : '16px',
                background: 'transparent',
                fontSize: isMobile ? '12px' : '13px',
                lineHeight: '1.6',
                color: '#e5e7eb',
              }}
            >
              <code>{code}</code>
            </pre>
          }
        >
          {syntaxStyle ? (
            <SyntaxHighlighter
              language={language || 'text'}
              style={syntaxStyle}
              showLineNumbers={!isMobile && lineCount > 3}
              wrapLines={!isMobile}
              customStyle={{
                margin: 0,
                padding: isMobile ? '12px' : '16px',
                background: 'transparent',
                fontSize: isMobile ? '12px' : '13px',
                lineHeight: '1.6',
                minWidth: 0,
              }}
              lineNumberStyle={{
                minWidth: '2.5em',
                paddingRight: '16px',
                color: '#5c6370',
                userSelect: 'none',
              }}
            >
              {code}
            </SyntaxHighlighter>
          ) : (
            <pre
              className="overflow-x-auto"
              style={{
                margin: 0,
                padding: isMobile ? '12px' : '16px',
                background: 'transparent',
                fontSize: isMobile ? '12px' : '13px',
                lineHeight: '1.6',
                color: '#e5e7eb',
              }}
            >
              <code>{code}</code>
            </pre>
          )}
        </Suspense>
      </div>

      {/* Collapsed fade overlay */}
      {collapsed && (
        <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-[#1e1e1e] to-transparent pointer-events-none" />
      )}
    </div>
  );
}
