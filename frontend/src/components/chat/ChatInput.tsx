import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Square, Paperclip, X, Plus, Mic, MicOff, Shield, ShieldOff } from 'lucide-react';
import { useToast } from '../common/Toast';
import type { Attachment } from '../../lib/types';

interface Props {
  onSend: (text: string, attachments?: Attachment[]) => void;
  onStop: () => void;
  loading: boolean;
  blockedByActionCenter?: boolean;
  safeMode?: boolean;
  onSafeModeToggle?: () => void;
  isMobile?: boolean;
  productMode?: 'web_chat' | 'desktop_code';
}

export default function ChatInput({ onSend, onStop, loading, blockedByActionCenter, safeMode, onSafeModeToggle, isMobile, productMode = 'desktop_code' }: Props) {
  const toastCtx = useToast();
  const toast = toastCtx?.toast;

  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isListening, setIsListening] = useState(false);
  const isElectronShell = typeof window !== 'undefined' && window.navigator.userAgent.includes('Electron');
  const disableMobileMic = Boolean(isMobile && !isElectronShell);
  
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);

  const toggleListening = useCallback(() => {
    if (isListening) {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      setIsListening(false);
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Bu cihazda və ya brauzerdə səsli daxiletmə (Speech Recognition) dəstəklənmir.");
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'az-AZ'; // Support native Azerbaijani voice recognition!

      recognition.onstart = () => {
        setIsListening(true);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognition.onerror = (event: any) => {
        console.error("Speech recognition error:", event.error);
        setIsListening(false);
        let errorMsg = `Səs tanıma xətası: "${event.error}".`;
        if (event.error === 'not-allowed') {
          errorMsg += "\nTip: Proqramın mikrofona giriş icazəsi yoxdur. Zəhmət olmasa tətbiq ayarlarından və ya macOS Sistem Ayarlarından (Security & Privacy -> Microphone) proqrama icazə verildiyini yoxlayın.";
        } else if (event.error === 'network') {
          errorMsg += "\nTip: Şəbəkə xətası. Səs tanıma sisteminin işləməsi üçün internet bağlantısı tələb olunur.";
        } else if (event.error === 'no-speech') {
          errorMsg += "\nTip: Səs aşkarlanmadı. Mikrofonunuzun düzgün işlədiyini və bir az ucadan danışdığınızı yoxlayın.";
        } else if (event.error === 'service-not-allowed') {
          errorMsg += "\nTip: Google Səs Tanıma servisinə bu Chromium/Electron mühitində icazə verilmir.";
        }
        alert(errorMsg);
      };

      recognition.onresult = (event: any) => {
        let finalTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          }
        }
        if (finalTranscript) {
          setText(prev => prev + (prev ? ' ' : '') + finalTranscript);
        }
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (e) {
      console.error("Speech recognition initialization error:", e);
      setIsListening(false);
    }
  }, [isListening]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, isMobile ? 120 : 200)}px`;
    }
  }, [text, isMobile]);

  const handleSend = useCallback(() => {
    if ((text.trim() || attachments.length > 0) && !loading && !blockedByActionCenter) {
      onSend(text, attachments);
      setText('');
      setAttachments([]);
    }
  }, [text, attachments, loading, blockedByActionCenter, onSend]);

  const pushFiles = useCallback((files: FileList | File[] | null) => {
    if (!files || files.length === 0) return;
    const allowedExtensions = /\.(png|jpe?g|gif|webp|pdf|docx?|xlsx?|csv|txt|md|json|ya?ml|xml|log)$/i;
    const selected = Array.from(files).slice(0, Math.max(0, 5 - attachments.length));
    if (selected.length === 0) {
      toast?.('Bir mesajda maksimum 5 fayl əlavə etmək olar.', 'info', 4000);
      return;
    }

    void Promise.all(selected.map((file) => new Promise<Attachment | null>((resolve) => {
      if (file.size > 10 * 1024 * 1024) {
        toast?.(`${file.name}: fayl ölçüsü 10 MB-dan böyükdür.`, 'error', 5000);
        resolve(null);
        return;
      }
      if (!file.type.startsWith('image/') && !allowedExtensions.test(file.name)) {
        toast?.(`${file.name}: bu fayl növü dəstəklənmir.`, 'error', 5000);
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve({
        id: globalThis.crypto?.randomUUID?.() || `attachment-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name: file.name,
        type: file.type.startsWith('image/') ? 'image' : 'file',
        mimeType: file.type || 'application/octet-stream',
        url: String(reader.result || ''),
      });
      reader.onerror = () => {
        toast?.(`${file.name}: faylı oxumaq alınmadı.`, 'error', 5000);
        resolve(null);
      };
      reader.readAsDataURL(file);
    }))).then((items) => {
      const valid = items.filter((item): item is Attachment => Boolean(item));
      if (valid.length > 0) setAttachments((previous) => [...previous, ...valid].slice(0, 5));
    });
  }, [attachments.length, toast]);

  const removeAttachment = useCallback((idx: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== idx));
  }, []);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const handler = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) pushFiles([file] as unknown as FileList);
          break;
        }
      }
    };
    el.addEventListener('paste', handler);
    return () => el.removeEventListener('paste', handler);
  }, [pushFiles]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.files.length > 0) pushFiles(e.dataTransfer.files);
  }, [pushFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const canSend = (text.trim() || attachments.length > 0) && !loading && !blockedByActionCenter;

  return (
    <div className={isMobile ? 'px-3 pb-1 pt-1 safe-bottom mobile-chat-input-wrap' : 'px-4 pb-4 pt-2'}>
      <div className="max-w-3xl mx-auto">
        {!isMobile && onSafeModeToggle && productMode !== 'web_chat' && (
          <div className="flex justify-center items-center gap-2 mb-2">
            <button
              onClick={onSafeModeToggle}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
              style={{
                color: safeMode ? 'var(--color-accent)' : 'var(--fg-muted)',
                background: safeMode ? 'var(--color-accent-muted)' : 'transparent'
              }}
              title={safeMode ? 'Safe Mode aktivdir — hər kritik əməliyyat üçün təsdiq tələb olunur. Söndürmək üçün klikləyin.' : 'Safe Mode söndürülüb — agent təsdiqsiz işləyir. Aktivləşdirmək üçün klikləyin.'}
              data-testid="safe-mode-toggle"
            >
              {safeMode ? <Shield size={12} /> : <ShieldOff size={12} />}
              {safeMode ? 'Safe Mode' : 'Auto'}
            </button>
          </div>
        )}

        {/* Input container — Gemini pill shape */}
        <div
          className={`relative flex items-center transition-all ${isMobile ? 'rounded-full px-3 py-1.5 shadow-lg border border-[#7F77DD]/15 bg-[var(--bg-surface-elevated)]' : 'rounded-3xl p-3 tahoe-glass'}`}
          style={{
            background: !isMobile ? (productMode === 'web_chat'
              ? 'linear-gradient(180deg, rgba(255,255,255,0.09), rgba(255,255,255,0.05))'
              : 'var(--glass-surface)') : undefined,
          }}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
        >
          {/* Attach button */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={loading || blockedByActionCenter || attachments.length >= 5}
            className="rounded-full transition-all shrink-0 flex items-center justify-center cursor-pointer hover:opacity-75 active:scale-95"
            style={{
              color: 'var(--fg-muted)',
              width: isMobile ? '30px' : '44px',
              height: isMobile ? '30px' : '44px',
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.06)',
              opacity: loading || blockedByActionCenter || attachments.length >= 5 ? 0.45 : 1,
            }}
            title="Şəkil və ya fayl əlavə et"
            aria-label="Attach file"
          >
            {isMobile ? <Plus size={16} /> : <Paperclip size={20} />}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            multiple
            accept="image/png,image/jpeg,image/gif,image/webp,.pdf,.doc,.docx,.xls,.xlsx,.pptx,.csv,.txt,.md,.json,.yaml,.yml,.xml,.log"
            onChange={(event) => {
              pushFiles(event.target.files);
              event.target.value = '';
            }}
            aria-label="Choose attachment"
          />

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
            }}
            placeholder={blockedByActionCenter ? 'Əvvəl Action Center-də login və ya təsdiq addımını tamamlayın...' : (productMode === 'web_chat' ? 'Mesajınızı yazın...' : 'bahAI-ya yazın...')}
            className={`flex-1 bg-transparent border-none outline-none resize-none leading-relaxed px-1.5 ${isMobile ? 'min-h-[20px]' : 'min-h-[24px]'}`}
            style={{
              color: 'var(--fg-main)',
              fontSize: isMobile ? '16px' : '15px',
              maxHeight: isMobile ? '120px' : '200px',
            }}
            disabled={blockedByActionCenter}
            aria-label="Message input"
          />

          {/* Action buttons (Mic + Send/Stop) — right */}
          <div className="flex items-center gap-1 shrink-0">
            {/* Pulsing style */}
            <style>{`
              @keyframes pulse-purple {
                0% {
                  box-shadow: 0 0 0 0 rgba(168, 85, 247, 0.4);
                }
                70% {
                  box-shadow: 0 0 0 10px rgba(168, 85, 247, 0);
                }
                100% {
                  box-shadow: 0 0 0 0 rgba(168, 85, 247, 0);
                }
              }
            `}</style>
            
            {/* Voice input disabled */}
            {false && !disableMobileMic && (
              <button
                onClick={toggleListening}
                type="button"
                className="rounded-full transition-all flex items-center justify-center shrink-0 tahoe-button"
                style={{
                  color: isListening ? '#a855f7' : 'var(--fg-muted)',
                  background: isListening ? 'rgba(168, 85, 247, 0.15)' : 'linear-gradient(180deg, rgba(255,255,255,0.1), rgba(255,255,255,0.04))',
                  width: isMobile ? '36px' : '40px',
                  height: isMobile ? '36px' : '40px',
                  border: isListening ? '1px solid rgba(168, 85, 247, 0.3)' : '1px solid rgba(255,255,255,0.08)',
                  boxShadow: isListening ? '0 0 15px rgba(168, 85, 247, 0.4)' : 'none',
                  animation: isListening ? 'pulse-purple 1.5s infinite' : 'none',
                }}
                title={isListening ? "Səsli daxiletməni dayandır" : "Səslə danış"}
                aria-label="Toggle voice input"
                aria-pressed={isListening}
                tabIndex={0}
              >
                {isListening ? <MicOff size={isMobile ? 16 : 18} /> : <Mic size={isMobile ? 16 : 18} />}
              </button>
            )}

            {loading ? (
              <button
                onClick={onStop}
                type="button"
                className="rounded-full transition-colors shrink-0 flex items-center justify-center tahoe-button"
                style={{
                  background: 'rgba(239, 68, 68, 0.1)',
                  color: '#ef4444',
                  width: isMobile ? '32px' : '40px',
                  height: isMobile ? '32px' : '40px',
                  border: '1px solid rgba(239, 68, 68, 0.18)',
                }}
                aria-label="Stop generation"
                tabIndex={0}
              >
                <Square size={isMobile ? 14 : 16} fill="currentColor" />
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!canSend}
                type="button"
                className="rounded-full transition-all shrink-0 flex items-center justify-center tahoe-button"
                style={{
                  background: canSend
                    ? 'linear-gradient(180deg, rgba(127, 119, 221, 0.95), rgba(127, 119, 221, 0.78))'
                    : 'linear-gradient(180deg, rgba(255,255,255,0.1), rgba(255,255,255,0.04))',
                  color: canSend ? 'white' : 'var(--fg-muted)',
                  cursor: canSend ? 'pointer' : 'default',
                  width: isMobile ? '32px' : '40px',
                  height: isMobile ? '32px' : '40px',
                  border: canSend ? '1px solid rgba(127, 119, 221, 0.65)' : '1px solid rgba(255,255,255,0.08)',
                }}
                aria-label="Send message"
                tabIndex={0}
              >
                <Send size={isMobile ? 14 : 16} />
              </button>
            )}
          </div>
        </div>

        {/* Attachments preview */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2 px-1">
            <div className="text-[10px] px-2 py-1 rounded-md" style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)', color: 'var(--fg-muted)' }}>
              {attachments.length} fayl — bütünlənlərindən cavab veriləcək
            </div>
            {attachments.map((at, i) => (
              <div
                key={at.id || i}
                className="group relative rounded-lg overflow-hidden"
                style={{ border: '1px solid var(--border)', background: 'var(--bg-hover)' }}
              >
                {at.type === 'image' ? (
                  <img src={at.url} alt={at.name} className="h-14 w-auto object-cover" />
                ) : (
                  <div className="flex items-center gap-2 px-3 py-2">
                    <Paperclip size={12} style={{ color: 'var(--fg-muted)' }} />
                    <span className="text-xs truncate max-w-[100px]" style={{ color: 'var(--fg-secondary)' }}>
                      {at.name}
                    </span>
                  </div>
                )}
                <button
                  onClick={() => removeAttachment(i)}
                  className="absolute top-1 right-1 p-1.5 rounded-full transition-opacity"
                  style={{ background: 'rgba(239, 68, 68, 0.9)', opacity: 1 }}
                  aria-label={`Remove ${at.name}`}
                >
                  <X size={10} className="text-white" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Disclaimer */}
        {!isMobile && (
          <div className="text-center mt-2">
            <span className="text-xs" style={{ color: 'var(--fg-muted)' }} role="note">
              {productMode === 'web_chat'
                ? 'Cavabları kritik qərardan əvvəl qısa yoxlamaq faydalıdır.'
                : 'bahAI səhv edə bilər. Vacib məlumatları yoxlayın.'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
