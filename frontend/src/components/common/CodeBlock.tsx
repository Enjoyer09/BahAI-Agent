import { useState, useCallback } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Copy, Check, ChevronDown, ChevronUp } from 'lucide-react';

interface CodeBlockProps {
  language?: string;
  children: string;
  inline?: boolean;
}

export default function CodeBlock({ language, children, inline }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

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
        className="flex items-center justify-between px-4 py-2"
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
              className="p-1.5 rounded-md text-gray-500 hover:text-gray-300 hover:bg-gray-700/50 transition-colors"
              title={collapsed ? 'Genişlət' : 'Yığ'}
            >
              {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
            </button>
          )}
          <button
            onClick={handleCopy}
            className="p-1.5 rounded-md text-gray-500 hover:text-gray-300 hover:bg-gray-700/50 transition-colors"
            title="Kopyala"
          >
            {copied ? (
              <Check size={14} className="text-green-400" />
            ) : (
              <Copy size={14} />
            )}
          </button>
        </div>
      </div>

      {/* Code */}
      <div
        className={`transition-all duration-300 ${
          collapsed ? 'max-h-[120px] overflow-hidden' : ''
        }`}
      >
        <SyntaxHighlighter
          language={language || 'text'}
          style={oneDark}
          showLineNumbers={lineCount > 3}
          wrapLines
          customStyle={{
            margin: 0,
            padding: '16px',
            background: 'transparent',
            fontSize: '13px',
            lineHeight: '1.6',
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
      </div>

      {/* Collapsed fade overlay */}
      {collapsed && (
        <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-[#1e1e1e] to-transparent pointer-events-none" />
      )}
    </div>
  );
}
