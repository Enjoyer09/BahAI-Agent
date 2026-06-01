import { User, Copy, Check, FileText, ChevronDown, ChevronRight, Loader2, ThumbsUp, ThumbsDown, RotateCcw, Bot, Volume2, VolumeX } from 'lucide-react';
import { useState, useCallback, useRef } from 'react';
import MarkdownRenderer from '../common/MarkdownRenderer';
import ToolCallCard from './ToolCallCard';
import type { Message } from '../../lib/types';

interface Props {
  message: Message;
  pendingApprovals?: { approvalId: string; tool: string; args: string }[];
  onApprove?: (id: string, decision: 'approve' | 'reject') => void;
}

export default function ChatMessage({ message, pendingApprovals, onApprove }: Props) {
  const [copied, setCopied] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  
  const isBot = message.role === 'assistant';
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const copyToClipboard = useCallback(() => {
    navigator.clipboard.writeText(message.content || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [message.content]);

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

    try {
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ text: cleanText })
      });

      if (response.ok) {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audioRef.current = audio;
        
        audio.onended = () => {
          setIsPlaying(false);
          audioRef.current = null;
        };
        
        audio.onerror = () => {
          speakWithBrowser(cleanText);
        };
        
        await audio.play();
        return;
      }
    } catch (e) {
      console.error("ElevenLabs request failed, falling back to browser TTS:", e);
    }

    // Fallback: Use browser Web Speech Synthesis
    speakWithBrowser(cleanText);
  }, [isPlaying, message.content, speakWithBrowser]);

  if (message.role === 'tool') return null;

  const hasRunningTools = message.tool_calls?.some(tc => tc.status === 'running');
  const hasTools = message.tool_calls && message.tool_calls.length > 0;

  return (
    <div className="group animate-in" style={{ animationDelay: '50ms' }}>
      <div className="flex items-start gap-3 sm:gap-4">
        {/* Avatar — circular */}
        <div
          className="w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5"
          style={{
            background: isBot ? 'var(--color-accent)' : '#8e8e8e',
          }}
        >
          {isBot ? (
            hasRunningTools ? (
              <Loader2 size={14} className="animate-spin text-white" />
            ) : (
              <Bot size={14} className="text-white" />
            )
          ) : (
            <User size={14} className="text-white" />
          )}
        </div>

        {/* Content — no bubble */}
        <div className="flex-1 min-w-0">
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

          {/* Message content — plain text */}
          <div className="leading-relaxed break-words relative">
            {/* Attachments */}
            {message.attachments && message.attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3">
                {message.attachments.map((at, i) => (
                  <div
                    key={i}
                    className="rounded-lg overflow-hidden"
                    style={{ border: '1px solid var(--border)', background: 'var(--bg-hover)' }}
                  >
                    {at.type === 'image' ? (
                      <img src={at.url} alt="attachment" className="max-w-[70vw] sm:max-w-[200px] h-auto" />
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
            <div className="prose prose-sm max-w-none" style={{ color: 'var(--fg-main)' }}>
              <MarkdownRenderer content={message.content || ''} />
            </div>

            {/* Copy button — always visible on mobile */}
            <button
              onClick={copyToClipboard}
              className="absolute top-0 right-0 p-2 rounded-md transition-opacity mobile-visible"
              style={{
                color: 'var(--fg-muted)',
                opacity: 1,
              }}
              aria-label="Copy message"
            >
              {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
            </button>
          </div>

          {/* Tool calls */}
          {isBot && hasTools && (
            <div className="mt-2">
              <button
                onClick={() => setShowTools(!showTools)}
                className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg transition-colors"
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
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Pending approvals */}
          {isBot && pendingApprovals && pendingApprovals.length > 0 && (
            <div className="mt-3 space-y-2">
              {pendingApprovals.map((approval) => (
                <div
                  key={approval.approvalId}
                  className="rounded-xl p-4 animate-in"
                  style={{
                    background: 'rgba(245, 158, 11, 0.08)',
                    border: '1px solid rgba(245, 158, 11, 0.2)',
                  }}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-semibold" style={{ color: '#fbbf24' }}>
                      Təsdiq tələb olunur
                    </span>
                  </div>
                  <div className="text-xs mb-3" style={{ color: 'var(--fg-secondary)' }}>
                    <span className="font-mono" style={{ color: 'var(--fg-main)' }}>{approval.tool}</span>
                  </div>
                  <pre
                    className="text-xs p-3 rounded-lg mb-3 overflow-auto max-h-32"
                    style={{ background: 'var(--bg-hover)', color: 'var(--fg-muted)' }}
                  >
                    {(() => {
                      try { return JSON.stringify(JSON.parse(approval.args), null, 2); }
                      catch { return approval.args; }
                    })()}
                  </pre>
                  <div className="flex gap-2">
                    <button
                      onClick={() => onApprove?.(approval.approvalId, 'reject')}
                      className="flex-1 px-4 py-3 text-sm rounded-lg transition-colors font-medium"
                      style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.2)', minHeight: '44px' }}
                    >
                      Rədd et
                    </button>
                    <button
                      onClick={() => onApprove?.(approval.approvalId, 'approve')}
                      className="flex-1 px-4 py-3 text-sm rounded-lg transition-colors font-medium"
                      style={{ background: 'rgba(34, 197, 94, 0.1)', color: '#4ade80', border: '1px solid rgba(34, 197, 94, 0.2)', minHeight: '44px' }}
                    >
                      Təsdiq et
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Message actions — always visible on mobile */}
          {isBot && !hasRunningTools && (
            <div className="flex items-center gap-1 mt-2 mobile-visible" style={{ opacity: 1 }}>
              <button
                className="p-2 rounded-md transition-colors"
                style={{ color: 'var(--fg-muted)', minHeight: '44px', minWidth: '44px' }}
                aria-label="Good response"
              >
                <ThumbsUp size={14} />
              </button>
              <button
                className="p-2 rounded-md transition-colors"
                style={{ color: 'var(--fg-muted)', minHeight: '44px', minWidth: '44px' }}
                aria-label="Bad response"
              >
                <ThumbsDown size={14} />
              </button>
              <button
                onClick={speakMessage}
                className="p-2 rounded-md transition-colors flex items-center justify-center"
                style={{
                  color: isPlaying ? 'var(--color-accent)' : 'var(--fg-muted)',
                  minHeight: '44px',
                  minWidth: '44px',
                  background: isPlaying ? 'var(--color-accent-muted)' : 'transparent'
                }}
                title={isPlaying ? "Səsi dayandır" : "Səsləndir (ElevenLabs / Səsli Dialoq)"}
                aria-label="Speak message"
              >
                {isPlaying ? <VolumeX size={14} className="animate-pulse" /> : <Volume2 size={14} />}
              </button>
              <button
                className="p-2 rounded-md transition-colors"
                style={{ color: 'var(--fg-muted)', minHeight: '44px', minWidth: '44px' }}
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
