import { User, Copy, Check, FileText, ChevronDown, ChevronRight, Loader2, ThumbsUp, ThumbsDown, RotateCcw, Sparkles, Volume2, VolumeX } from 'lucide-react';
import { useState, useCallback, useRef, lazy, Suspense } from 'react';
import ToolCallCard from './ToolCallCard';
import type { Message } from '../../lib/types';
import { trackEvent } from '../../lib/telemetry';
import { useToast } from '../common/Toast';

const TelemetryEvents = {
  FEEDBACK_POSITIVE: 'message_feedback_positive',
  FEEDBACK_NEGATIVE: 'message_feedback_negative',
  REGENERATE: 'message_regenerate',
} as const;

const MarkdownRenderer = lazy(() => import('../common/MarkdownRenderer'));

interface Props {
  message: Message;
  workingDirectory?: string;
  productMode?: 'web_chat' | 'desktop_code';
}

function renderInlineSystemContent(content: string) {
  const parts = String(content || '').split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map((part, index) => {
    const boldMatch = part.match(/^\*\*([^*]+)\*\*$/);
    if (boldMatch) {
      return <strong key={`${index}-${boldMatch[1]}`}>{boldMatch[1]}</strong>;
    }
    return <span key={`${index}-${part}`}>{part}</span>;
  });
}

export default function ChatMessage({ message, workingDirectory, productMode = 'desktop_code' }: Props) {
  const [copied, setCopied] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const isMobile = typeof window !== 'undefined' && window.innerWidth <= 768;
  const isDesktopProduct = productMode === 'desktop_code';
  const isBot = message.role === 'assistant';
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const copyToClipboard = useCallback(() => {
    navigator.clipboard.writeText(message.content || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [message.content]);

  // Keyboard handler for action buttons
  const handleActionKeyDown = useCallback((e: React.KeyboardEvent, action: () => void) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      action();
    }
  }, []);

  const speakWithBrowser = useCallback((text: string) => {
    if (!window.speechSynthesis) {
      alert("Bu cihazda səs oxuma dəstəklənmir.");
      setIsPlaying(false);
      return;
    }

    window.speechSynthesis.cancel(); // Stop any currently playing voices
    const utterance = new SpeechSynthesisUtterance(text);
    
    // Find Azerbaijani/Turkish or close voice if available
    const voices = window.speechSynthesis.getVoices();
    const azVoice = voices.find(v => v.lang.startsWith('az')) || voices.find(v => v.lang.startsWith('tr')) || voices.find(v => v.lang.startsWith('en'));
    if (azVoice) {
      utterance.voice = azVoice;
    }
    
    utterance.onend = () => {
      setIsPlaying(false);
    };
    
    utterance.onerror = () => {
      setIsPlaying(false);
    };

    window.speechSynthesis.speak(utterance);
  }, []);

  const speakMessage = useCallback(async () => {
    if (isPlaying) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      setIsPlaying(false);
      return;
    }

    const cleanText = (message.content || '')
      .replace(/```[\s\S]*?```/g, '[Kod bloku]') // Replace code blocks with [Kod bloku] so it doesn't read out full source code line by line!
      .replace(/`([^`]+)`/g, '$1')
      .replace(/[*_#]/g, '')
      .trim();

    if (!cleanText) return;

    setIsPlaying(true);

    // Use browser Web Speech Synthesis directly
    speakWithBrowser(cleanText);
  }, [isPlaying, message.content, speakWithBrowser]);

  const toast = useToast();

  const handleThumbsUp = useCallback(() => {
    trackEvent(TelemetryEvents.FEEDBACK_POSITIVE, {
      messageId: message.id,
      contentLength: (message.content || '').length,
    });
    toast.success('Rəy qeydə alındı');
  }, [message.id, message.content, toast]);

  const handleThumbsDown = useCallback(() => {
    trackEvent(TelemetryEvents.FEEDBACK_NEGATIVE, {
      messageId: message.id,
      contentLength: (message.content || '').length,
    });
    toast.info('Rəy qeydə alındı. Daha ətraflı yazsanız kömək edər.');
  }, [message.id, message.content, toast]);

  const handleRegenerate = useCallback(() => {
    trackEvent(TelemetryEvents.REGENERATE, {
      messageId: message.id,
    });
    toast.info('Yenidən yazma üçün yeni mesaj göndərin');
  }, [message.id, toast]);

  if (message.role === 'tool') return null;
  // the Auto router's choice. Render as a small inline pill so it doesn't
  // dominate the conversation.
  if (message.role === 'system') {
    const systemText = String(message.content || '');
    const isMetaSystemNote = /^(Workflow:|Faza:|☁️ Auto|🦙 Auto)/i.test(systemText);
    if (productMode === 'web_chat' && isMetaSystemNote) return null;
    const compactSystemText = isMetaSystemNote
      ? systemText
          .replace(/\*\*/g, '')
          .replace(/\s*\|\s*/g, ' · ')
          .replace(/\nMarşrut:[^\n]*/i, '')
          .replace(/\nSəbəb:[\s\S]*/i, '')
          .replace(/^Workflow:\s*/i, '')
          .replace(/^Faza:\s*/i, '')
          .trim()
      : systemText;
    return (
      <div className="flex items-center justify-center my-1" data-testid={`system-note-${message.id}`}>
        <div
          className="text-[11px] px-2.5 py-1 rounded-full truncate max-w-full"
          style={{
            background: 'var(--bg-hover)',
            color: 'var(--fg-secondary)',
            border: '1px solid var(--border-subtle)'
          }}
        >
          <span>{renderInlineSystemContent(compactSystemText)}</span>
        </div>
      </div>
    );
  }

  const hasRunningTools = productMode === 'desktop_code' && message.tool_calls?.some(tc => tc.status === 'running');
  const hasTools = productMode === 'desktop_code' && message.tool_calls && message.tool_calls.length > 0;

  // web_chat shows avatars on both desktop and mobile (mirrors desktop web_chat,
  // which already renders them). desktop_code stays avatar-less on every surface.
  const showAvatar = !isDesktopProduct;
  const avatarStyle = {
    background: isBot
      ? 'linear-gradient(135deg, #7F77DD 0%, #534AB7 60%, #3C3489 100%)'
      : 'linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)',
    boxShadow: isBot
      ? '0 0 16px rgba(127, 119, 221, 0.45), inset 0 1px 1px rgba(255, 255, 255, 0.3)'
      : '0 0 14px rgba(139, 92, 246, 0.35), inset 0 1px 1px rgba(255, 255, 255, 0.25)',
    border: isBot ? '1px solid rgba(52, 211, 153, 0.5)' : '1px solid rgba(167, 139, 250, 0.4)',
  };
  const avatarIcon = isBot
    ? (hasRunningTools ? <Loader2 size={14} className="animate-spin text-white" /> : <Sparkles size={14} className="text-white drop-shadow-[0_0_4px_rgba(255,255,255,0.8)]" />)
    : <User size={14} className="text-white" />;

  return (
    <div className="group animate-in" style={{ animationDelay: '50ms' }}>
      <div className={`flex items-start ${isMobile ? `gap-2 ${isBot ? 'pl-2' : 'justify-end'}` : 'gap-2.5 sm:gap-4'}`}>
        {showAvatar && (
          <div
            className={`w-7 h-7 ${!isMobile ? 'sm:w-8 sm:h-8' : ''} rounded-full flex items-center justify-center shrink-0 mt-0.5`}
            style={avatarStyle}
            aria-hidden="true"
          >
            {avatarIcon}
          </div>
        )}

        <div className={`flex-1 min-w-0 ${(isMobile || isDesktopProduct) && !isBot ? 'max-w-[85%] ml-auto' : ''}`}>
          {/* Running indicator */}
          {isBot && hasRunningTools && (
            <div
              className="mb-2 flex items-center gap-2 px-3 py-2 rounded-lg w-fit text-xs"
              style={{
                background: 'var(--color-accent-muted)',
                border: '1px solid var(--border)',
                color: 'var(--color-accent)',
              }}
            >
              <Loader2 size={12} className="animate-spin" />
              <span className="font-medium">İcra olunur...</span>
            </div>
          )}

          <div
            className={`leading-relaxed break-words ${isMobile && !isBot ? 'rounded-2xl px-4 py-2.5' : 'rounded-[22px] px-4 py-3 sm:px-4.5 sm:py-3.5'} ${isMobile && isBot ? 'pl-2' : ''}`}
            style={isBot ? ((isMobile || isDesktopProduct) ? {
              background: 'var(--bg-surface-elevated, rgba(255,255,255,0.03))',
              border: '1px solid var(--border-subtle)',
              boxShadow: 'none'
            } : {
              background: 'var(--bg-surface-elevated, rgba(255,255,255,0.03))',
              border: '1px solid var(--border-subtle)',
              boxShadow: '0 14px 34px rgba(0,0,0,0.06)'
            }) : ((isMobile || isDesktopProduct) ? {
              background: 'var(--color-accent-muted)',
              border: '1px solid var(--border-subtle)',
            } : {
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.05)'
            })}
          >
            {/* Attachments */}
            {message.attachments && message.attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2.5 sm:mb-3">
                {message.attachments.map((at, i) => (
                  <div
                    key={i}
                    className="rounded-lg overflow-hidden"
                    style={{ border: '1px solid var(--border)', background: 'var(--bg-hover)' }}
                  >
                    {at.type === 'image' ? (
                      at.url ? (
                        <img src={at.url} alt="attachment" className="max-w-[70vw] sm:max-w-[200px] h-auto" />
                      ) : (
                        <div className="flex items-center gap-2 px-3 py-2">
                          <FileText size={14} style={{ color: 'var(--fg-muted)' }} />
                          <span className="text-xs truncate max-w-[150px]" style={{ color: 'var(--fg-secondary)' }}>
                            {at.name}
                          </span>
                        </div>
                      )
                    ) : (
                      <div className="flex items-center gap-2 px-3 py-2">
                        <FileText size={14} style={{ color: 'var(--fg-muted)' }} />
                        <span className="text-xs truncate max-w-[150px]" style={{ color: 'var(--fg-secondary)' }}>
                          {at.name}
                        </span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Content */}
            {(() => {
              const displayContent = (message.content || '')
                .replace(/```(?:json)?[\s\S]*?```/gi, (match) => {
                  // Remove only actual tool-call JSON blocks. Do not hide a
                  // legitimate Python/JS/HTML block just because game code
                  // contains variables such as `name`, `query`, or `arguments`.
                  const body = match.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
                  const isJsonToolBlock = /^\{[\s\S]*\}$/.test(body)
                    && /"(?:name|arguments|query|tool|function)"\s*:/.test(body)
                    && /web_search|browser_open|browser_eval|gui_step|run_terminal_command/i.test(body);
                  if (isJsonToolBlock) return '';
                  return match;
                })
                .replace(/\{\s*"name"\s*:[\s\S]*?\}/gi, '')
                .trim();
              if (!displayContent && message.tool_calls && message.tool_calls.length > 0) return null;
              return (
                <div className="prose prose-sm max-w-none min-w-0" style={{ color: 'var(--fg-main)' }}>
                  <Suspense fallback={<div className="text-sm leading-relaxed" style={{ color: 'var(--fg-main)' }}>{displayContent}</div>}>
                    <MarkdownRenderer content={displayContent} />
                  </Suspense>
                </div>
              );
            })()}
          </div>

          {/* Tool calls */}
          {isBot && hasTools && (
            <div className="mt-2">
              <button
                onClick={() => setShowTools(!showTools)}
                className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg transition-colors w-full sm:w-auto justify-between sm:justify-start"
                style={{
                  color: 'var(--fg-muted)',
                  background: showTools ? 'var(--bg-hover)' : 'transparent',
                  minHeight: '44px',
                }}
              >
                {showTools ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                {message.tool_calls!.length} tool call{message.tool_calls!.length > 1 ? 's' : ''}
              </button>

              {showTools && (
                <div className="mt-2 space-y-2 animate-in">
                  {message.tool_calls!.map((tc, j) => (
                    <ToolCallCard
                      key={j}
                      toolName={tc.function?.name || tc.name}
                      args={tc.function?.arguments || tc.args}
                      result={tc.result}
                      status={tc.status}
                      duration={tc.duration}
                      workingDirectory={workingDirectory}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Message actions — always visible on mobile */}
          {isBot && !hasRunningTools && (
            <div className={`mt-2 flex flex-wrap items-center ${isMobile ? 'gap-0.5 mobile-message-actions' : 'gap-1.5 sm:gap-1'} mobile-visible`} style={{ opacity: 1 }} role="group" aria-label="Message actions">
              <button
                onClick={copyToClipboard}
                onKeyDown={(e) => handleActionKeyDown(e, copyToClipboard)}
                className={`inline-flex items-center ${isMobile ? 'gap-0 p-1.5' : 'gap-1.5 px-2.5 py-2 sm:p-2'} rounded-md transition-colors`}
                style={isMobile ? { color: 'var(--fg-muted)' } : { color: 'var(--fg-muted)', minHeight: '40px' }}
                aria-label="Copy message"
              >
                {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                {!isMobile && <span className="text-[11px] sm:hidden">{copied ? 'Kopyalandı' : 'Kopyala'}</span>}
              </button>
              <button
                onClick={handleThumbsUp}
                onKeyDown={(e) => handleActionKeyDown(e, handleThumbsUp)}
                className={`${isMobile ? 'p-1.5' : 'p-2'} rounded-md transition-colors`}
                style={isMobile ? { color: 'var(--fg-muted)' } : { color: 'var(--fg-muted)', minHeight: '40px', minWidth: '40px' }}
                aria-label="Good response"
              >
                <ThumbsUp size={14} />
              </button>
              <button
                onClick={handleThumbsDown}
                onKeyDown={(e) => handleActionKeyDown(e, handleThumbsDown)}
                className={`${isMobile ? 'p-1.5' : 'p-2'} rounded-md transition-colors`}
                style={isMobile ? { color: 'var(--fg-muted)' } : { color: 'var(--fg-muted)', minHeight: '40px', minWidth: '40px' }}
                aria-label="Bad response"
              >
                <ThumbsDown size={14} />
              </button>
              <button
                onClick={speakMessage}
                onKeyDown={(e) => handleActionKeyDown(e, speakMessage)}
                className={`${isMobile ? 'p-1.5' : 'p-2'} rounded-md transition-colors flex items-center justify-center`}
                style={isMobile ? {
                  color: isPlaying ? 'var(--color-accent)' : 'var(--fg-muted)',
                  background: isPlaying ? 'var(--color-accent-muted)' : 'transparent'
                } : {
                  color: isPlaying ? 'var(--color-accent)' : 'var(--fg-muted)',
                  minHeight: '40px',
                  minWidth: '40px',
                  background: isPlaying ? 'var(--color-accent-muted)' : 'transparent'
                }}
                title={isPlaying ? "Səsi dayandır" : "Səsləndir"}
                aria-label="Speak message"
              >
                {isPlaying ? <VolumeX size={14} className="animate-pulse" /> : <Volume2 size={14} />}
              </button>
              <button
                onClick={handleRegenerate}
                onKeyDown={(e) => handleActionKeyDown(e, handleRegenerate)}
                className={`${isMobile ? 'p-1.5' : 'p-2'} rounded-md transition-colors`}
                style={isMobile ? { color: 'var(--fg-muted)' } : { color: 'var(--fg-muted)', minHeight: '40px', minWidth: '40px' }}
                aria-label="Regenerate"
              >
                <RotateCcw size={14} />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
