import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Square, Paperclip, X, Plus, ChevronDown, Mic, MicOff, Shield, ShieldOff } from 'lucide-react';
import type { Attachment } from '../../lib/types';
import { MODELS } from '../../lib/constants';

interface Props {
  onSend: (text: string, attachments?: Attachment[]) => void;
  onStop: () => void;
  loading: boolean;
  blockedByActionCenter?: boolean;
  safeMode?: boolean;
  onSafeModeToggle?: () => void;
  model?: string;
  onModelChange?: (model: string) => void;
  isMobile?: boolean;
}

export default function ChatInput({ onSend, onStop, loading, blockedByActionCenter, safeMode, onSafeModeToggle, model, onModelChange, isMobile }: Props) {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [isListening, setIsListening] = useState(false);
  
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    if (!showModelDropdown) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowModelDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showModelDropdown]);

  const handleSend = useCallback(() => {
    if ((text.trim() || attachments.length > 0) && !loading && !blockedByActionCenter) {
      onSend(text, attachments);
      setText('');
      setAttachments([]);
    }
  }, [text, attachments, loading, blockedByActionCenter, onSend]);

  const pushFiles = useCallback((files: FileList | null) => {
    if (!files) return;
    const ALLOWED_EXTENSIONS = ['.txt', '.json', '.csv', '.md', '.yaml', '.yml', '.xml', '.log', '.env', '.js', '.ts', '.jsx', '.tsx', '.py', '.html', '.css', '.har', '.svg', '.sh', '.toml', '.ini', '.cfg', '.conf', '.sql', '.graphql', '.prisma', '.dockerfile', '.gitignore'];
    
    Array.from(files).forEach(file => {
      const ext = '.' + file.name.split('.').pop()?.toLowerCase();
      const isText = file.type.startsWith('text/') || file.type.includes('json') || file.type.includes('xml');
      
      if (!ALLOWED_EXTENSIONS.includes(ext) && !isText) {
        alert(`"${file.name}" dəstəklənmir. Yalnız mətn faylları qəbul edilir: ${ALLOWED_EXTENSIONS.join(', ')}`);
        return;
      }
      
      // File size check: max 500KB for text files
      if (file.size > 500 * 1024) {
        alert(`"${file.name}" çox böyükdür (${(file.size / 1024).toFixed(0)}KB). Maksimum 500KB.`);
        return;
      }
      const reader = new FileReader();
      reader.onload = (ev) => {
        setAttachments(prev => [...prev, {
          id: crypto.randomUUID(),
          name: file.name,
          type: 'file',
          mimeType: file.type || 'text/plain',
          url: ev.target?.result as string
        }]);
      };
      reader.readAsDataURL(file);
    });
  }, []);

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
  const selectedModel = MODELS.find(m => m.id === model);

  return (
    <div className={isMobile ? 'px-2 pb-2 pt-1 safe-bottom' : 'px-4 pb-4 pt-2'}>
      <div className="max-w-3xl mx-auto">
        {/* Model selector + Safe Mode toggle — desktop only */}
        {onModelChange && model && !isMobile && (
          <div className="flex justify-center items-center gap-2 mb-2 relative" ref={dropdownRef}>
            <button
              onClick={() => setShowModelDropdown(!showModelDropdown)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
              style={{ color: 'var(--fg-muted)' }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              data-testid="model-selector-btn"
            >
              {selectedModel?.name || model}
              <ChevronDown size={12} />
            </button>

            {/* FUNC-FIX: Safe Mode toggle was hidden in OpsPanel — now visible
                  next to the model selector. Clear icon + tooltip. */}
            {onSafeModeToggle && (
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
            )}

            {showModelDropdown && (
              <div
                className="absolute bottom-full mb-1 rounded-lg overflow-hidden animate-scale-in z-50"
                style={{
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)',
                  boxShadow: 'var(--shadow-lg)',
                  minWidth: '200px',
                }}
              >
                {MODELS.map(m => (
                  <button
                    key={m.id}
                    onClick={() => { onModelChange(m.id); setShowModelDropdown(false); }}
                    className="w-full text-left px-3 py-2.5 text-sm transition-colors"
                    style={{
                      color: m.id === model ? 'var(--color-accent)' : 'var(--fg-secondary)',
                      background: m.id === model ? 'var(--color-accent-muted)' : 'transparent',
                    }}
                    onMouseEnter={(e) => { if (m.id !== model) e.currentTarget.style.background = 'var(--bg-hover)'; }}
                    onMouseLeave={(e) => { if (m.id !== model) e.currentTarget.style.background = 'transparent'; }}
                  >
                    {m.name}
                    <span className="text-[10px] ml-2" style={{ color: 'var(--fg-muted)' }}>{m.provider}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Input container — pill shape */}
        <div
          className="relative flex items-end rounded-3xl transition-all"
          style={{
            background: 'var(--bg-surface-alt)',
            border: '1px solid var(--border)',
            padding: isMobile ? '8px 10px' : '12px 14px',
          }}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
        >
          {/* Attach button — left */}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="rounded-full transition-colors shrink-0 flex items-center justify-center"
            style={{
              color: 'var(--fg-muted)',
              width: isMobile ? '40px' : '44px',
              height: isMobile ? '40px' : '44px',
            }}
            title="Fayl əlavə et"
            aria-label="Attach file"
          >
            <Plus size={isMobile ? 18 : 20} />
          </button>
          <input
            type="file"
            ref={fileInputRef}
            onChange={(e) => { pushFiles(e.target.files); e.target.value = ''; }}
            multiple
            accept=".txt,.json,.csv,.md,.yaml,.yml,.xml,.log,.env,.js,.ts,.jsx,.tsx,.py,.html,.css,.har,.svg,.sh,.toml,.ini,.cfg,.sql,.graphql"
            className="hidden"
            aria-hidden="true"
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
            placeholder={blockedByActionCenter ? 'Əvvəl Action Center-də login və ya təsdiq addımını tamamlayın...' : 'bahAI-ya yazın...'}
            className="flex-1 bg-transparent border-none outline-none resize-none min-h-[24px] leading-relaxed px-1.5"
            style={{
              color: 'var(--fg-main)',
              fontSize: isMobile ? '16px' : '14px', // 16px prevents iOS zoom
              maxHeight: isMobile ? '96px' : '200px',
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
            
            {/* Microphone button */}
            <button
              onClick={toggleListening}
              type="button"
              className="rounded-full transition-all flex items-center justify-center shrink-0"
              style={{
                color: isListening ? '#a855f7' : 'var(--fg-muted)',
                background: isListening ? 'rgba(168, 85, 247, 0.15)' : 'transparent',
                width: isMobile ? '36px' : '40px',
                height: isMobile ? '36px' : '40px',
                border: isListening ? '1px solid rgba(168, 85, 247, 0.3)' : 'none',
                boxShadow: isListening ? '0 0 15px rgba(168, 85, 247, 0.4)' : 'none',
                animation: isListening ? 'pulse-purple 1.5s infinite' : 'none',
              }}
              title={isListening ? "Səsli daxiletməni dayandır" : "Səslə danış"}
              aria-label="Toggle voice input"
            >
              {isListening ? <MicOff size={isMobile ? 16 : 18} /> : <Mic size={isMobile ? 16 : 18} />}
            </button>

            {loading ? (
              <button
                onClick={onStop}
                type="button"
                className="rounded-full transition-colors shrink-0 flex items-center justify-center"
                style={{
                  background: 'rgba(239, 68, 68, 0.1)',
                  color: '#ef4444',
                  width: isMobile ? '36px' : '40px',
                  height: isMobile ? '36px' : '40px',
                }}
                aria-label="Stop generation"
              >
                <Square size={isMobile ? 14 : 16} fill="currentColor" />
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!canSend}
                type="button"
                className="rounded-full transition-all shrink-0 flex items-center justify-center"
                style={{
                  background: canSend ? 'var(--color-accent)' : 'transparent',
                  color: canSend ? 'white' : 'var(--fg-muted)',
                  cursor: canSend ? 'pointer' : 'default',
                  width: isMobile ? '36px' : '40px',
                  height: isMobile ? '36px' : '40px',
                }}
                aria-label="Send message"
              >
                <Send size={isMobile ? 14 : 16} />
              </button>
            )}
          </div>
        </div>

        {/* Attachments preview */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2 px-1">
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
        <div className={isMobile ? 'text-center mt-1 px-1' : 'text-center mt-2'}>
          <span className="text-xs" style={{ color: 'var(--fg-muted)' }}>
            bahAI səhv edə bilər. Vacib məlumatları yoxlayın.
          </span>
        </div>
      </div>
    </div>
  );
}
