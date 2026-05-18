import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Square, Paperclip, X, Shield } from 'lucide-react';
import type { Attachment } from '../../lib/types';

interface Props {
  onSend: (text: string, attachments?: Attachment[]) => void;
  onStop: () => void;
  loading: boolean;
  safeMode?: boolean;
  onSafeModeToggle?: () => void;
}

export default function ChatInput({ onSend, onStop, loading, safeMode, onSafeModeToggle }: Props) {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [text]);

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

  // Paste image from clipboard
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const handler = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
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

  // Drag and drop
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const files: File[] = [];
    if (e.dataTransfer.items) {
      for (let i = 0; i < e.dataTransfer.items.length; i++) {
        const item = e.dataTransfer.items[i];
        if (item.kind === 'file') {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
    }
    if (files.length > 0) pushFiles(files as unknown as FileList);
  }, [pushFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const canSend = (text.trim() || attachments.length > 0) && !loading;

  return (
    <div className="px-4 pb-4 pt-2">
      <div
        className="max-w-3xl mx-auto rounded-2xl p-3 transition-all"
        style={{
          background: 'var(--bg-surface-alt)',
          border: '1px solid var(--border)',
        }}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
      >
        {/* Attachments */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {attachments.map((at, i) => (
              <div
                key={at.id || i}
                className="group relative rounded-lg overflow-hidden"
                style={{ border: '1px solid var(--border)', background: 'var(--bg-hover)' }}
              >
                {at.type === 'image' ? (
                  <img src={at.url} alt={at.name} className="h-16 w-auto object-cover" />
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
                  className="absolute top-0.5 right-0.5 p-0.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ background: 'rgba(239, 68, 68, 0.9)' }}
                  aria-label={`Remove ${at.name}`}
                >
                  <X size={10} className="text-white" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Input area */}
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
            }}
            placeholder="Ask anything..."
            className="flex-1 bg-transparent border-none outline-none text-sm resize-none min-h-[24px] max-h-[200px] leading-relaxed"
            style={{ color: 'var(--fg-main)' }}
            aria-label="Message input"
          />

          <div className="flex items-center gap-1 shrink-0">
            {/* Safe mode toggle */}
            {onSafeModeToggle && (
              <button
                onClick={onSafeModeToggle}
                className="p-1.5 rounded-md transition-colors"
                style={{
                  color: safeMode ? 'var(--color-warning)' : 'var(--fg-muted)',
                  background: safeMode ? 'rgba(245, 158, 11, 0.1)' : 'transparent',
                }}
                title={safeMode ? 'Safe Mode ON' : 'Safe Mode OFF'}
                aria-label={`Safe mode ${safeMode ? 'on' : 'off'}`}
              >
                <Shield size={14} />
              </button>
            )}

            {/* File attach */}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="p-1.5 rounded-md transition-colors"
              style={{ color: 'var(--fg-muted)' }}
              title="Attach file"
              aria-label="Attach file"
            >
              <Paperclip size={14} />
            </button>
            <input
              type="file"
              ref={fileInputRef}
              onChange={(e) => { pushFiles(e.target.files); e.target.value = ''; }}
              multiple
              className="hidden"
              aria-hidden="true"
            />

            {/* Send / Stop */}
            {loading ? (
              <button
                onClick={onStop}
                className="p-1.5 rounded-md transition-colors"
                style={{
                  background: 'rgba(239, 68, 68, 0.1)',
                  color: '#ef4444',
                  border: '1px solid rgba(239, 68, 68, 0.2)',
                }}
                aria-label="Stop generation"
              >
                <Square size={14} fill="currentColor" />
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!canSend}
                className="p-1.5 rounded-md transition-all"
                style={{
                  background: canSend ? 'var(--color-accent)' : 'var(--bg-hover)',
                  color: canSend ? 'var(--fg-on-accent)' : 'var(--fg-muted)',
                  cursor: canSend ? 'pointer' : 'default',
                }}
                aria-label="Send message"
              >
                <Send size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Bottom hints */}
        <div className="flex items-center justify-between mt-2 px-1">
          <span className="text-[10px]" style={{ color: 'var(--fg-muted)' }}>
            Shift+Enter for new line
          </span>
          <span className="text-[10px]" style={{ color: 'var(--fg-muted)' }}>
            {text.length > 0 ? `${text.length} chars` : ''}
          </span>
        </div>
      </div>
    </div>
  );
}
