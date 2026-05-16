// ==========================================
// ChatArea — Message container with auto-scroll
// ==========================================

import { useEffect, useRef } from 'react';
import ChatMessage from './ChatMessage';
import type { Message } from '../../lib/types';
import { MessageSquare } from 'lucide-react';

interface ChatAreaProps {
  messages: Message[];
  loading: boolean;
}

export default function ChatArea({ messages, loading }: ChatAreaProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-[var(--fg-muted)] opacity-50 select-none">
        <div className="w-16 h-16 rounded-2xl bg-[var(--bg-surface-alt)] flex items-center justify-center mb-4">
          <MessageSquare size={32} />
        </div>
        <h2 className="text-lg font-semibold mb-2">Necə kömək edə bilərəm?</h2>
        <p className="text-sm max-w-[300px] text-center leading-relaxed">
          Kod yazmaq, xətaları düzəltmək və ya yeni bir layihə qurmaq üçün mənə yazın.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6 space-y-8 scroll-smooth">
      {messages.map((msg, i) => (
        <ChatMessage key={msg.id} message={msg} isLast={i === messages.length - 1} />
      ))}
      {loading && (
        <div className="flex items-start gap-4 animate-pulse">
          <div className="w-8 h-8 rounded-lg bg-[var(--bg-surface-alt)]" />
          <div className="flex-1 space-y-2 mt-1">
            <div className="h-3 w-1/4 bg-[var(--bg-surface-alt)] rounded" />
            <div className="h-3 w-1/2 bg-[var(--bg-surface-alt)] rounded" />
          </div>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
