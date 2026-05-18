import { useRef, useEffect } from 'react';
import { MessageSquare } from 'lucide-react';
import type { Message } from '../../lib/types';
import ChatMessage from './ChatMessage';
import { Spinner } from '../common/UI';

interface Props {
  messages: Message[];
  loading: boolean;
  onSend: (msg: string) => void;
  onStop?: () => void;
  pendingApprovals: { approvalId: string; tool: string; args: string }[];
  onApprove: (id: string, decision: 'approve' | 'reject') => void;
}

export default function ChatArea({ messages, loading, onSend, pendingApprovals, onApprove }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isAtBottom = useRef(true);

  useEffect(() => {
    if (isAtBottom.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    isAtBottom.current = scrollHeight - scrollTop - clientHeight < 80;
  };

  if (messages.length === 0 && !loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 pb-32">
        {/* Logo */}
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center mb-6"
          style={{ background: 'var(--color-accent)' }}
        >
          <MessageSquare size={32} className="text-white" />
        </div>

        {/* Heading */}
        <h2 className="text-2xl font-semibold mb-8" style={{ color: 'var(--fg-main)' }}>
          Necə kömək edə bilərəm?
        </h2>

        {/* Suggestion cards */}
        <div className="flex flex-wrap justify-center gap-3 max-w-2xl">
          {[
            { label: 'React app yarat', prompt: 'Create a new React app with TypeScript and Tailwind CSS' },
            { label: 'Səhv düzəlt', prompt: 'Help me fix a bug in my code' },
            { label: 'Kodu izah et', prompt: 'Explain what this code does' },
            { label: 'Funksiya əlavə et', prompt: 'Add a new feature to my project' },
          ].map((item) => (
            <button
              key={item.label}
              onClick={() => onSend(item.prompt)}
              className="px-4 py-2.5 rounded-xl text-sm transition-all"
              style={{
                border: '1px solid var(--border)',
                color: 'var(--fg-secondary)',
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto premium-scroll"
      style={{ scrollBehavior: 'smooth' }}
    >
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {messages.map((msg, i) => (
          <ChatMessage
            key={msg.id || i}
            message={msg}
            pendingApprovals={pendingApprovals}
            onApprove={onApprove}
          />
        ))}

        {loading && messages[messages.length - 1]?.role !== 'assistant' && (
          <div className="flex items-start gap-4 animate-in">
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
              style={{ background: 'var(--color-accent)' }}
            >
              <Spinner size={14} className="text-white" />
            </div>
            <div className="flex-1 pt-0.5">
              <div className="typing-indicator">
                <span /><span /><span />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
