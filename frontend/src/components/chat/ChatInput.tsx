import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Square, Paperclip, X, Plus, ChevronDown } from 'lucide-react';
import type { Attachment } from '../../lib/types';
import { MODELS } from '../../lib/constants';

interface Props {
  onSend: (text: string, attachments?: Attachment[]) => void;
  onStop: () => void;
  loading: boolean;
  safeMode?: boolean;
  onSafeModeToggle?: () => void;
  model?: string;
  onModelChange?: (model: string) => void;
  isMobile?: boolean;
}

export default function ChatInput({ onSend, onStop, loading, model, onModelChange, isMobile }: Props) {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

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
    if ((text.trim() || attachments.length > 0) && !loading) {
      onSend(text, attachments);
      setText('');
      setAttachments([]);
    }
  }, [text, attachments, loading, onSend]);

  const pushFiles = useCallback((files: FileList | null) => {
    if (!files) return;
    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        setAttachments(prev => [...prev, {
          id: crypto.randomUUID(),
          name: file.name,
          type: file.type.startsWith('image/') ? 'image' : 'file',
          mimeType: file.type || 'application/octet-stream',
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

  const canSend = (text.trim() || attachments.length > 0) && !loading;
  const selectedModel = MODELS.find(m => m.id === model);

  return (
    <div className={isMobile ? 'px-3 pb-3 pt-1 safe-bottom' : 'px-4 pb-4 pt-2'}>
      <div className="max-w-3xl mx-auto">
        {/* Model selector — desktop only */}
        {onModelChange && model && !isMobile && (
          <div className="flex justify-center mb-2 relative" ref={dropdownRef}>
            <button
              onClick={() => setShowModelDropdown(!showModelDropdown)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
              style={{ color: 'var(--fg-muted)' }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              {selectedModel?.name || model}
              <ChevronDown size={12} />
            </button>

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
            padding: isMobile ? '10px 12px' : '12px 14px',
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
              width: '44px',
              height: '44px',
            }}
            title="Fayl əlavə et"
            aria-label="Attach file"
          >
            <Plus size={20} />
          </button>
          <input
            type="file"
            ref={fileInputRef}
            onChange={(e) => { pushFiles(e.target.files); e.target.value = ''; }}
            multiple
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
            placeholder="bahAI-ya yazın..."
            className="flex-1 bg-transparent border-none outline-none resize-none min-h-[24px] leading-relaxed px-2"
            style={{
              color: 'var(--fg-main)',
              fontSize: isMobile ? '16px' : '14px', // 16px prevents iOS zoom
              maxHeight: isMobile ? '120px' : '200px',
            }}
            aria-label="Message input"
          />

          {/* Send / Stop button — right */}
          {loading ? (
            <button
              onClick={onStop}
              className="rounded-full transition-colors shrink-0 flex items-center justify-center"
              style={{
                background: 'rgba(239, 68, 68, 0.1)',
                color: '#ef4444',
                width: '44px',
                height: '44px',
              }}
              aria-label="Stop generation"
            >
              <Square size={18} fill="currentColor" />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!canSend}
              className="rounded-full transition-all shrink-0 flex items-center justify-center"
              style={{
                background: canSend ? 'var(--color-accent)' : 'transparent',
                color: canSend ? 'white' : 'var(--fg-muted)',
                cursor: canSend ? 'pointer' : 'default',
                width: '44px',
                height: '44px',
              }}
              aria-label="Send message"
            >
              <Send size={18} />
            </button>
          )}
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
        <div className="text-center mt-2">
          <span className="text-xs" style={{ color: 'var(--fg-muted)' }}>
            bahAI səhv edə bilər. Vacib məlumatları yoxlayın.
          </span>
        </div>
      </div>
    </div>
  );
}
