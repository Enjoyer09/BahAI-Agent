import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import CodeBlock from './CodeBlock';
import ArtifactBlock from '../chat/ArtifactBlock';
import { linkifyUrls } from '../../lib/linkifyUrls';
import type { Components } from 'react-markdown';

interface MarkdownRendererProps {
  content: string;
}

export default function MarkdownRenderer({ content }: MarkdownRendererProps) {
  const safeContent = linkifyUrls(typeof content === 'string' ? content : '');
  const components: Partial<Components> = {
    code({ className, children }) {
      const match = /language-(\w+)/.exec(className || '');
      const isInline = !match && !String(children).includes('\n');
      if (isInline) return <CodeBlock inline>{String(children)}</CodeBlock>;
      const language = (match?.[1] || '').toLowerCase();
      const code = String(children).replace(/\n$/, '');
      return <CodeBlock language={language}>{code}</CodeBlock>;
    },
    table({ children }) {
      return (
        <div className="overflow-x-auto my-2.5 sm:my-3 rounded-lg" style={{ border: '1px solid var(--border)' }}>
          <table className="w-full text-sm">{children}</table>
        </div>
      );
    },
    thead({ children }) {
      return <thead style={{ background: 'var(--bg-surface-alt)', borderBottom: '1px solid var(--border)' }}>{children}</thead>;
    },
    th({ children }) {
      return <th className="text-left px-2 sm:px-4 py-2 sm:py-2.5 font-semibold text-xs uppercase tracking-wider" style={{ color: 'var(--fg-secondary)' }}>{children}</th>;
    },
    td({ children }) {
      return <td className="px-2 sm:px-4 py-2 sm:py-2.5" style={{ color: 'var(--fg-main)', borderTop: '1px solid var(--border-subtle)' }}>{children}</td>;
    },
    h1({ children }) {
      return <h1 className="text-lg sm:text-[1.35rem] font-semibold mt-5 sm:mt-6 mb-2.5 sm:mb-3 tracking-tight" style={{ color: 'var(--fg-main)' }}>{children}</h1>;
    },
    h2({ children }) {
      return <h2 className="text-[15px] sm:text-[1.1rem] font-semibold mt-4 sm:mt-5 mb-2 tracking-tight" style={{ color: 'var(--fg-main)' }}>{children}</h2>;
    },
    h3({ children }) {
      return <h3 className="text-sm sm:text-[1rem] font-semibold mt-3.5 sm:mt-4 mb-1.5 sm:mb-2" style={{ color: 'var(--fg-main)' }}>{children}</h3>;
    },
    ul({ children }) {
      return <ul className="list-disc list-inside space-y-1.5 my-2.5 ml-0.5 sm:ml-1" style={{ color: 'var(--fg-main)' }}>{children}</ul>;
    },
    ol({ children }) {
      return <ol className="list-decimal list-inside space-y-1.5 my-2.5 ml-0.5 sm:ml-1" style={{ color: 'var(--fg-main)' }}>{children}</ol>;
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
      return <p className="my-2 sm:my-2.5 leading-7" style={{ color: 'var(--fg-main)' }}>{children}</p>;
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
    <div className="markdown-content text-[14px] sm:text-[15px] leading-7">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{safeContent}</ReactMarkdown>
    </div>
  );
}
