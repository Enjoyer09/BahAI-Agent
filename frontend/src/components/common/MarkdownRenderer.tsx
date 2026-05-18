import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import CodeBlock from './CodeBlock';
import type { Components } from 'react-markdown';

interface MarkdownRendererProps {
  content: string;
}

export default function MarkdownRenderer({ content }: MarkdownRendererProps) {
  const components: Partial<Components> = {
    code({ className, children }) {
      const match = /language-(\w+)/.exec(className || '');
      const isInline = !match && !String(children).includes('\n');
      if (isInline) return <CodeBlock inline>{String(children)}</CodeBlock>;
      return <CodeBlock language={match?.[1]}>{String(children).replace(/\n$/, '')}</CodeBlock>;
    },
    table({ children }) {
      return (
        <div className="overflow-x-auto my-3 rounded-lg" style={{ border: '1px solid var(--border)' }}>
          <table className="w-full text-sm">{children}</table>
        </div>
      );
    },
    thead({ children }) {
      return <thead style={{ background: 'var(--bg-surface-alt)', borderBottom: '1px solid var(--border)' }}>{children}</thead>;
    },
    th({ children }) {
      return <th className="text-left px-4 py-2.5 font-semibold text-xs uppercase tracking-wider" style={{ color: 'var(--fg-secondary)' }}>{children}</th>;
    },
    td({ children }) {
      return <td className="px-4 py-2.5" style={{ color: 'var(--fg-main)', borderTop: '1px solid var(--border-subtle)' }}>{children}</td>;
    },
    h1({ children }) {
      return <h1 className="text-xl font-bold mt-6 mb-3" style={{ color: 'var(--fg-main)' }}>{children}</h1>;
    },
    h2({ children }) {
      return <h2 className="text-lg font-semibold mt-5 mb-2" style={{ color: 'var(--fg-main)' }}>{children}</h2>;
    },
    h3({ children }) {
      return <h3 className="text-base font-semibold mt-4 mb-2" style={{ color: 'var(--fg-main)' }}>{children}</h3>;
    },
    ul({ children }) {
      return <ul className="list-disc list-inside space-y-1 my-2 ml-1" style={{ color: 'var(--fg-main)' }}>{children}</ul>;
    },
    ol({ children }) {
      return <ol className="list-decimal list-inside space-y-1 my-2 ml-1" style={{ color: 'var(--fg-main)' }}>{children}</ol>;
    },
    li({ children }) {
      return <li className="leading-relaxed" style={{ color: 'var(--fg-main)' }}>{children}</li>;
    },
    blockquote({ children }) {
      return (
        <blockquote
          className="border-l-4 pl-4 my-3 py-1 rounded-r-lg"
          style={{ borderColor: 'var(--border)', color: 'var(--fg-secondary)' }}
        >
          {children}
        </blockquote>
      );
    },
    a({ href, children }) {
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 transition-colors"
          style={{ color: 'var(--color-accent)' }}
        >
          {children}
        </a>
      );
    },
    p({ children }) {
      return <p className="my-2 leading-relaxed" style={{ color: 'var(--fg-main)' }}>{children}</p>;
    },
    hr() {
      return <hr className="my-4" style={{ borderColor: 'var(--border-subtle)' }} />;
    },
    strong({ children }) {
      return <strong className="font-semibold" style={{ color: 'var(--fg-main)' }}>{children}</strong>;
    },
    em({ children }) {
      return <em className="italic" style={{ color: 'var(--fg-secondary)' }}>{children}</em>;
    },
  };

  return (
    <div className="markdown-content text-[15px] leading-relaxed">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{content}</ReactMarkdown>
    </div>
  );
}
