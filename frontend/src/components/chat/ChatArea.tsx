import { useRef, useEffect } from 'react';
import { MessageSquare, Square } from 'lucide-react';
import type { Message } from '../../lib/types';
import { MessageBubble } from './MessageBubble';
import { Spinner } from '../common/UI';

interface Props {
  messages: Message[];
  loading: boolean;
  onSend: (msg: string) => void;
  onStop?: () => void;
  onLoadOlderMessages?: () => void | Promise<void>;
  canLoadOlderMessages?: boolean;
  loadingOlderMessages?: boolean;
  workingDirectory?: string;
  productMode?: 'web_chat' | 'desktop_code';
}

export default function ChatArea({
  messages,
  loading,
  onSend,
  onStop,
  onLoadOlderMessages,
  canLoadOlderMessages = false,
  loadingOlderMessages = false,
  workingDirectory,
  productMode = 'desktop_code'
}: Props) {
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
      <div className="flex-1 flex flex-col items-center justify-center px-4 sm:px-6 pb-16 sm:pb-32">
        <div
          className="w-14 h-14 sm:w-16 sm:h-16 rounded-full flex items-center justify-center mb-5 sm:mb-6 shadow-[0_18px_50px_rgba(16,163,127,0.18)]"
          style={{
            background: 'linear-gradient(180deg, rgba(16,163,127,0.96), rgba(16,163,127,0.78))',
            border: '1px solid rgba(255,255,255,0.16)'
          }}
        >
          <MessageSquare size={28} className="text-white" />
        </div>

        <h2 className="text-xl sm:text-3xl font-semibold mb-2 text-center tracking-tight" style={{ color: 'var(--fg-main)' }}>
          {productMode === 'web_chat' ? 'Bu gün nədən başlayaq?' : 'BahAI Desktop ilə nə qururuq?'}
        </h2>
        <p className="text-sm sm:text-base text-center mb-6 sm:mb-8 max-w-xl leading-7" style={{ color: 'var(--fg-secondary)' }}>
          {productMode === 'web_chat'
            ? 'Sual verin, mətni yaxşılaşdırın, ideyanı dəqiqləşdirin və ya bir şəkil göndərin.'
            : 'Repo ilə işləyin, audit etdirin, bug düzəltdirin və yeni funksiya qurun.'}
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-3 max-w-2xl w-full">
          {(productMode === 'web_chat'
            ? [
                { label: 'Yazını yaxşılaşdır', prompt: 'Bu mətni daha aydın, peşəkar və axıcı formada yenidən yaz' },
                { label: 'Qısa plan qur', prompt: 'Bu iş üçün mənə qısa, praktik və prioritetləşdirilmiş plan hazırla' },
                { label: 'Məlumatı izah et', prompt: 'Bu mövzunu sadə dildə, qısa və anlaşılan formada izah et' },
                { label: 'Sürətli audit', prompt: 'Bu ideyanın və ya mətnin zəif tərəflərini qısa audit et və yaxşılaşdırma təklif et' },
              ]
            : [
                { label: 'Repo audit et', prompt: 'Bu layihəni senior engineer kimi audit et, əsas riskləri və prioritet düzəlişləri çıxart' },
                { label: 'Səhv düzəlt', prompt: 'Bu layihədəki bug-u tap və düzəlt, sonra yoxla' },
                { label: 'Feature qur', prompt: 'Bu layihəyə yeni bir funksiya əlavə et və uyğun faylları yenilə' },
                { label: 'Refactor et', prompt: 'Bu kod hissəsini daha təmiz və maintainable şəkildə refactor et' },
              ]).map((item) => (
            <button
              key={item.label}
              onClick={() => onSend(item.prompt)}
              className="px-4 py-3.5 rounded-2xl text-sm transition-all text-left"
              style={{
                border: '1px solid var(--border)',
                color: 'var(--fg-secondary)',
                minHeight: '44px',
                background: 'var(--bg-surface-elevated, rgba(255,255,255,0.03))',
                boxShadow: '0 12px 32px rgba(0,0,0,0.08)'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--bg-hover)';
                e.currentTarget.style.transform = 'translateY(-1px)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'var(--bg-surface-elevated, rgba(255,255,255,0.03))';
                e.currentTarget.style.transform = 'translateY(0)';
              }}
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
      <div className="max-w-3xl mx-auto px-3 sm:px-4 py-4 sm:py-7 space-y-4 sm:space-y-6">
        <style>{`
          @keyframes bahai-wave {
            0%, 60%, 100% { transform: translateY(0); opacity: 0.35; }
            30% { transform: translateY(-5px); opacity: 1; }
          }
        `}</style>
        {canLoadOlderMessages && onLoadOlderMessages && (
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => void onLoadOlderMessages()}
              disabled={loadingOlderMessages}
              className="px-3.5 py-2 rounded-xl text-xs sm:text-sm transition-all disabled:opacity-60"
              style={{
                border: '1px solid var(--border)',
                color: 'var(--fg-secondary)',
                background: 'var(--bg-surface-elevated, var(--bg-surface))',
                minHeight: '38px',
              }}
            >
              {loadingOlderMessages ? 'Yüklənir...' : 'Əvvəlki mesajları göstər'}
            </button>
          </div>
        )}
        {messages.map((msg, i) => (
          <MessageBubble
            key={msg.id || i}
            message={msg}
          />
        ))}

        {loading && !messages.some((msg) => msg.role === 'assistant' && /Düşünürəm/i.test(msg.content || '')) && (
          <div className="flex items-start gap-3 sm:gap-4 animate-in">
            <div
              className="w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center shrink-0"
              style={{
                background: 'linear-gradient(180deg, rgba(16,163,127,0.96), rgba(16,163,127,0.78))',
                boxShadow: '0 10px 24px rgba(16,163,127,0.18)'
              }}
            >
              <Spinner size={14} className="text-white" />
            </div>
            <div className="flex-1 pt-0.5 flex items-center gap-3">
              <div
                className="flex items-center px-3 py-2.5 rounded-2xl"
                aria-label="Assistant is thinking"
                title="BahAI cavab hazırlayır"
                style={{
                  background: 'var(--bg-surface-elevated, rgba(255,255,255,0.03))',
                  border: '1px solid var(--border-subtle)',
                  boxShadow: '0 10px 30px rgba(0,0,0,0.06)'
                }}
              >
                <div className="flex items-end gap-1.5 h-5" aria-hidden="true">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <span
                      key={i}
                      className="block rounded-full"
                      style={{
                        width: '6px',
                        height: `${7 + ((i + 1) % 3) * 3}px`,
                        background: 'var(--color-accent)',
                        animation: `bahai-wave 1s ease-in-out ${i * 0.1}s infinite`
                      }}
                    />
                  ))}
                </div>
              </div>
              {onStop && (
                <button
                  onClick={onStop}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                  style={{
                    color: '#ef4444',
                    background: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid rgba(239, 68, 68, 0.2)',
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)'}
                  aria-label="Stop generating"
                >
                  <Square size={12} fill="currentColor" />
                  Dayandır
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
