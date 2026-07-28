/**
 * bahAI - Composer + Attachment Tray
 * Adapted from LibreChat's input area.
 * Provides a UI logic pattern for adding/removing attachments before sending a message.
 */

import React, { useState, useRef } from 'react';
import { Paperclip, Send, X, FileText, Square } from 'lucide-react';

interface Attachment {
  id: string;
  file: File;
  previewUrl?: string;
}

interface ComposerProps {
  onSendMessage: (text: string, attachments: File[]) => void;
  disabled?: boolean;
  isGenerating?: boolean;
  onStop?: () => void;
  settings?: any;
}

export function Composer({ onSendMessage, disabled, isGenerating, onStop, settings }: ComposerProps) {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newAttachments = Array.from(e.target.files).map(file => ({
        id: Math.random().toString(36).substring(7),
        file,
        previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined
      }));
      setAttachments(prev => [...prev, ...newAttachments]);
    }
  };

  const removeAttachment = (id: string) => {
    setAttachments(prev => prev.filter(att => att.id !== id));
  };

  const handleSubmit = () => {
    if ((text.trim() || attachments.length > 0) && !disabled) {
      onSendMessage(text, attachments.map(a => a.file));
      setText('');
      setAttachments([]);
    }
  };

  return (
    <div 
      className="flex flex-col w-full rounded-lg shadow-sm p-3 relative"
      style={{
        backgroundColor: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        color: 'var(--fg-main)'
      }}
    >
      {/* Attachment Tray */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3 pb-3" style={{ borderBottom: '1px solid var(--border)' }}>
          {attachments.map(att => (
            <div 
              key={att.id} 
              className="relative flex items-center justify-center rounded-md p-1 h-16 w-16 group"
              style={{ backgroundColor: 'var(--bg-surface-alt)', border: '1px solid var(--border-subtle)' }}
            >
              {att.previewUrl ? (
                <img src={att.previewUrl} alt="preview" className="h-full w-full object-cover rounded" />
              ) : (
                <FileText size={24} style={{ color: 'var(--fg-muted)' }} />
              )}
              <button
                onClick={() => removeAttachment(att.id)}
                className="absolute -top-2 -right-2 rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ backgroundColor: 'var(--color-danger)', color: 'white' }}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input Area */}
      <div className="flex items-end gap-2">
        <button 
          type="button"
          onClick={() => {
            if (typeof window !== 'undefined' && (window as any).__BAHAI_TOAST) {
              (window as any).__BAHAI_TOAST("Hələ ki Pre-Beta versiya olduğuna görə fayl yükləmələri (attachments) aktiv edilməyib. Komandamız sizin rahatlığınız üçün aktiv şəkildə çalışır! 🚀", "info", 5000);
            } else {
              alert("Hələ ki Pre-Beta versiya olduğuna görə fayl yükləmələri (attachments) aktiv edilməyib. Komandamız sizin rahatlığınız üçün aktiv şəkildə çalışır! 🚀");
            }
          }}
          className="p-2 transition-all opacity-40 cursor-pointer hover:opacity-75 active:scale-95"
          style={{ color: 'var(--fg-muted)', filter: 'grayscale(100%)' }}
          title="Pre-Beta: Fayl yükləmə müvəqqəti passivdir"
          aria-label="Attach file pre-beta"
        >
          <Paperclip size={20} />
        </button>
        <input 
          type="file" 
          multiple 
          className="hidden" 
          ref={fileInputRef} 
          onChange={handleFileSelect}
        />
        
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            const shouldEnterToSend = settings?.enterToSend !== false;
            
            if (e.key === 'Enter') {
              if (shouldEnterToSend) {
                if (!e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              } else {
                // If Enter To Send is OFF, Enter just adds a newline. 
                // Wait, if it just adds a newline, we don't preventDefault.
                // But how do they send? They click the button. Or maybe Shift+Enter sends? 
                // Usually if EnterToSend is off, Shift+Enter or Ctrl+Enter sends.
                if (e.ctrlKey || e.metaKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }
            }
          }}
          placeholder="Mesajınızı yazın..."
          className="flex-1 bg-transparent outline-none resize-none max-h-32 py-2"
          style={{ color: 'var(--fg-main)' }}
          rows={1}
          disabled={disabled}
        />

        {isGenerating ? (
          <button 
            onClick={onStop}
            className="p-2 rounded-md transition-opacity hover:opacity-90"
            style={{ backgroundColor: 'var(--color-danger)', color: 'white' }}
            title="Yaradılmanı Dayandır (Stop Generation)"
          >
            <Square size={18} fill="currentColor" />
          </button>
        ) : (
          <button 
            onClick={handleSubmit}
            disabled={disabled || (!text.trim() && attachments.length === 0)}
            className="p-2 rounded-md transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ 
              backgroundColor: (disabled || (!text.trim() && attachments.length === 0)) ? 'var(--bg-surface-alt)' : 'var(--color-accent)',
              color: (disabled || (!text.trim() && attachments.length === 0)) ? 'var(--fg-muted)' : 'white'
            }}
            title="Göndər (Send)"
          >
            <Send size={18} />
          </button>
        )}
      </div>
    </div>
  );
}
