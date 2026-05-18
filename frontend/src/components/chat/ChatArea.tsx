import { useRef, useEffect } from 'react';
import { MessageSquare } from 'lucide-react';
import type { Message } from '../../lib/types';
import ChatMessage from './ChatMessage';
import { Spinner } from '../common/UI';

interface Props {
  messages: Message[];
  loading: boolean;
  onSend: (msg: string) => void;
  onStop: () => void;
  pendingApprovals: { approvalId: string; tool: string; args: string }[];
  onApprove: (id: string, decision: 'approve' | 'reject') => void;
}

export default function ChatArea({ messages, loading, onSend, onStop, pendingApprovals, onApprove }: Props) {
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
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center max-w-md animate-in">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-5"
            style={{ background: 'var(--color-accent-muted)', border: '1px solid var(--border)' }}
          >
            <MessageSquare size={24} style={{ color: 'var(--color-accent)' }} />
          </div>
          <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--fg-main)' }}>
            How can I help?
          </h2>
          <p className="text-sm mb-6" style={{ color: 'var(--fg-muted)' }}>
            Ask me to write code, fix bugs, explain concepts, or build entire features.
          </p>
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: 'Create a React app', prompt: 'Create a new React app with TypeScript and Tailwind CSS' },
              { label: 'Fix a bug', prompt: 'Help me fix a bug in my code' },
              { label: 'Explain code', prompt: 'Explain what this code does' },
              { label: 'Add a feature', prompt: 'Add a new feature to my project' },
            ].map((item) => (
              <button
                key={item.label}
                onClick={() => onSend(item.prompt)}
                className="text-left p-3 rounded-xl text-sm transition-all hover:scale-[1.02]"
                style={{
                  background: 'var(--bg-surface-alt)',
                  border: '1px solid var(--border)',
                  color: 'var(--fg-secondary)',
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
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
          <div className="flex items-start gap-3 animate-in">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: 'var(--color-accent-muted)', border: '1px solid var(--border)' }}
            >
              <Spinner size={14} className="text-blue-400" />
            </div>
            <div className="flex-1 pt-1">
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
