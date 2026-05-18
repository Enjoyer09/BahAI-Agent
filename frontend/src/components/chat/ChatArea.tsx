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
      <div className="flex-1 flex flex-col items-center justify-center px-6 pb-20 sm:pb-32">
        {/* Logo */}
        <div
          className="w-14 h-14 sm:w-16 sm:h-16 rounded-full flex items-center justify-center mb-5 sm:mb-6"
          style={{ background: 'var(--color-accent)' }}
        >
          <MessageSquare size={28} className="text-white" />
        </div>

        {/* Heading */}
        <h2 className="text-xl sm:text-2xl font-semibold mb-6 sm:mb-8 text-center" style={{ color: 'var(--fg-main)' }}>
          Necə kömək edə bilərəm?
        </h2>

        {/* Suggestion cards */}
        <div className="flex flex-col sm:flex-row flex-wrap justify-center gap-2 sm:gap-3 max-w-2xl w-full">
          {[
            { label: 'React app yarat', prompt: 'Create a new React app with TypeScript and Tailwind CSS' },
            { label: 'Səhv düzəlt', prompt: 'Help me fix a bug in my code' },
            { label: 'Kodu izah et', prompt: 'Explain what this code does' },
            { label: 'Funksiya əlavə et', prompt: 'Add a new feature to my project' },
          ].map((item) => (
            <button
              key={item.label}
              onClick={() => onSend(item.prompt)}
              className="px-4 py-3 sm:py-2.5 rounded-xl text-sm transition-all text-center sm:text-left"
              style={{
                border: '1px solid var(--border)',
                color: 'var(--fg-secondary)',
                minHeight: '44px',
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
      <div className="max-w-3xl mx-auto px-3 sm:px-4 py-4 sm:py-6 space-y-4 sm:space-y-6">
        {messages.map((msg, i) => (
          <ChatMessage
            key={msg.id || i}
            message={msg}
            pendingApprovals={pendingApprovals}
            onApprove={onApprove}
          />
        ))}

        {loading && messages[messages.length - 1]?.role !== 'assistant' && (
          <div className="flex items-start gap-3 sm:gap-4 animate-in">
            <div
              className="w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center shrink-0"
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
